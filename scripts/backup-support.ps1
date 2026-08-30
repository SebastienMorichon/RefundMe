Set-StrictMode -Version Latest

$LydocNodeOperatorImage = "node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32"
$LydocAlpineOperatorImage = "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"
$LydocPostgresOperatorImage = "postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"

function Get-LydocContainerIsolationArguments(
  [string] $Memory = "512m",
  [int] $PidsLimit = 128
) {
  return @(
    "--network", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", [string] $PidsLimit,
    "--memory", $Memory,
    "--cpus", "1.0"
  )
}

function Get-LydocExpectedDocumentObjectReferences(
  [string] $PostgresContainer,
  [string] $DatabaseUser,
  [string] $DatabaseName
) {
  $ReservationTableProbe = @(
    'SELECT CASE WHEN to_regclass(''public."StorageWriteReservation"'') IS NULL THEN ''0'' ELSE ''1'' END;' |
      & docker exec -i $PostgresContainer psql `
        -U $DatabaseUser `
        -d $DatabaseName `
        -v ON_ERROR_STOP=1 `
        -q -tA
  )
  if ($LASTEXITCODE -ne 0) {
    throw "Detecting the storage-write reservation table failed."
  }
  $HasStorageWriteReservations = @(
    $ReservationTableProbe |
      ForEach-Object { ([string] $_).Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  ) -contains "1"
  $ReservationUnion = if ($HasStorageWriteReservations) {
    @'
  UNION
  SELECT "storageBucket" || '/' || "storageKey" AS reference
    FROM "StorageWriteReservation"
    WHERE "storageBucket" IS NOT NULL AND "objectDeletedAt" IS NULL
'@
  } else {
    ""
  }

  $Sql = @"
SELECT reference
FROM (
  SELECT "storageBucket" || '/' || "storageKey" AS reference FROM "Document"
  UNION
  SELECT "storageBucket" || '/' || "storageKey" AS reference
    FROM "DocumentStorageRevision" WHERE "deletedAt" IS NULL
  UNION
  SELECT "storageBucket" || '/' || "storageKey" AS reference FROM "GeneratedPacket"
  UNION
  SELECT "storageBucket" || '/' || "storageKey" AS reference
    FROM "StoragePurgeJob" WHERE "status" = 'PENDING'
$ReservationUnion
) AS object_references
ORDER BY reference;
"@
  $Output = @(
    $Sql |
      & docker exec -i $PostgresContainer psql `
        -U $DatabaseUser `
        -d $DatabaseName `
        -v ON_ERROR_STOP=1 `
        -q -tA
  )
  $DockerExitCode = $LASTEXITCODE
  if ($DockerExitCode -ne 0) {
    throw "Counting expected document objects failed with exit code $DockerExitCode."
  }
  $References = @(
    $Output |
      ForEach-Object { ([string] $_).Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )
  foreach ($Reference in $References) {
    if (
      $Reference.Length -gt 512 -or
      $Reference.StartsWith("/") -or
      $Reference.Contains("\") -or
      @($Reference.Split("/") | Where-Object { $_ -eq "." -or $_ -eq ".." }).Count -gt 0
    ) {
      throw "The database returned an unsafe document-object reference."
    }
  }
  return $References
}

function Get-LydocExpectedDocumentObjectReferenceCount(
  [string] $PostgresContainer,
  [string] $DatabaseUser,
  [string] $DatabaseName
) {
  return @(
    Get-LydocExpectedDocumentObjectReferences `
      -PostgresContainer $PostgresContainer `
      -DatabaseUser $DatabaseUser `
      -DatabaseName $DatabaseName
  ).Count
}

function Assert-LydocDocumentArchiveState(
  [bool] $ArchiveEmpty,
  [long] $ExpectedObjectReferences
) {
  if ($ExpectedObjectReferences -lt 0) {
    throw "The expected document-object count cannot be negative."
  }
  if ($ArchiveEmpty -and $ExpectedObjectReferences -ne 0) {
    throw "The document volume is empty but the database references $ExpectedObjectReferences expected object(s). Refusing an incomplete backup."
  }
  if ($ArchiveEmpty) {
    return "database-confirmed-zero-object-references"
  }
  return "volume-contained-files"
}

function Read-LydocDotEnv([string] $Path) {
  $Values = @{}
  foreach ($Line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ($Line -match '^\s*(?:#|$)') { continue }
    if ($Line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      throw "Invalid dotenv line in $Path."
    }
    $Name = $Matches[1]
    $Value = $Matches[2].Trim()
    if ($Value -match '^(?:"(.*)"|''(.*)'')$') {
      $Value = if ($null -ne $Matches[1]) { $Matches[1] } else { $Matches[2] }
    }
    $Values[$Name] = $Value
  }
  return $Values
}

function Test-LydocPlaceholder([string] $Value) {
  return $Value -match '(?i)(change[_-]?me|replace-with|example\.(com|invalid)|your[-_])'
}

function Get-LydocBackupKey(
  [string] $EnvironmentPath,
  [AllowEmptyString()]
  [string] $RequiredKeyId = ""
) {
  $Configuration = Read-LydocDotEnv $EnvironmentPath
  $CurrentKeyId = [string] $Configuration["BACKUP_ENCRYPTION_KEY_ID"]
  $CurrentSecret = [string] $Configuration["BACKUP_ENCRYPTION_SECRET"]
  $DocumentSecret = [string] $Configuration["DOCUMENT_ENCRYPTION_SECRET"]

  if ([string]::IsNullOrWhiteSpace($CurrentKeyId) -or (Test-LydocPlaceholder $CurrentKeyId)) {
    throw "BACKUP_ENCRYPTION_KEY_ID is missing or invalid."
  }
  if ($CurrentSecret.Length -lt 32 -or (Test-LydocPlaceholder $CurrentSecret)) {
    throw "BACKUP_ENCRYPTION_SECRET must be a non-placeholder secret of at least 32 characters."
  }
  if ($CurrentSecret -eq $DocumentSecret) {
    throw "BACKUP_ENCRYPTION_SECRET must be independent from DOCUMENT_ENCRYPTION_SECRET."
  }

  if ([string]::IsNullOrWhiteSpace($RequiredKeyId) -or $RequiredKeyId -ceq $CurrentKeyId) {
    return [pscustomobject]@{ KeyId = $CurrentKeyId; Secret = $CurrentSecret }
  }

  $PreviousRaw = [string] $Configuration["BACKUP_ENCRYPTION_PREVIOUS_KEYS"]
  if ([string]::IsNullOrWhiteSpace($PreviousRaw)) {
    throw "Backup key '$RequiredKeyId' is unavailable. Configure BACKUP_ENCRYPTION_PREVIOUS_KEYS before restoring it."
  }

  try {
    $PreviousKeys = $PreviousRaw | ConvertFrom-Json
  } catch {
    throw "BACKUP_ENCRYPTION_PREVIOUS_KEYS is not valid JSON."
  }
  if (
    $null -eq $PreviousKeys -or
    $PreviousKeys -is [array] -or
    $PreviousKeys -is [string] -or
    $PreviousKeys -is [ValueType]
  ) {
    throw "BACKUP_ENCRYPTION_PREVIOUS_KEYS must be a JSON object keyed by key ID."
  }

  $Match = @($PreviousKeys.PSObject.Properties | Where-Object { $_.Name -ceq $RequiredKeyId })
  if ($Match.Count -ne 1) {
    throw "Backup key '$RequiredKeyId' is unavailable."
  }
  $SelectedSecret = [string] $Match[0].Value
  if (
    $SelectedSecret.Length -lt 32 -or
    (Test-LydocPlaceholder $SelectedSecret) -or
    $SelectedSecret -eq $DocumentSecret
  ) {
    throw "Backup key '$RequiredKeyId' is invalid or reuses the document-encryption secret."
  }

  return [pscustomobject]@{ KeyId = $RequiredKeyId; Secret = $SelectedSecret }
}

function Invoke-LydocBackupCrypto(
  [ValidateSet("encrypt", "decrypt")]
  [string] $Operation,
  [string] $InputPath,
  [string] $OutputPath,
  [string] $Secret,
  [string] $ScriptsRoot
) {
  $ResolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
  $ResolvedScripts = (Resolve-Path -LiteralPath $ScriptsRoot).Path
  $OutputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
  if (Test-Path -LiteralPath $OutputFullPath) {
    throw "Refusing to overwrite backup crypto output: $OutputFullPath"
  }

  $InputDirectory = Split-Path -Parent $ResolvedInput
  $OutputDirectory = Split-Path -Parent $OutputFullPath
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  $InputName = [System.IO.Path]::GetFileName($ResolvedInput)
  $OutputName = [System.IO.Path]::GetFileName($OutputFullPath)
  if (
    [System.IO.Path]::GetFileName($InputName) -ne $InputName -or
    [System.IO.Path]::GetFileName($OutputName) -ne $OutputName
  ) {
    throw "Unsafe backup crypto path."
  }

  $DockerArguments = @(
    "run", "--rm", "-i"
  ) + (Get-LydocContainerIsolationArguments -Memory "256m" -PidsLimit 64) + @(
    "--user", "1000:1000",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m,uid=1000,gid=1000,mode=0700",
    "--mount", "type=bind,source=$ResolvedScripts,target=/tool,readonly",
    "--mount", "type=bind,source=$InputDirectory,target=/input,readonly",
    "--mount", "type=bind,source=$OutputDirectory,target=/output",
    $LydocNodeOperatorImage, "node", "/tool/backup-crypto.mjs", $Operation,
    "/input/$InputName", "/output/$OutputName"
  )

  $Secret | & docker @DockerArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Backup $Operation failed with exit code $LASTEXITCODE."
  }
}
