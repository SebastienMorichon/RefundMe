param(
  [Parameter(Mandatory = $true)]
  [string] $BackupDirectory,
  [string] $EnvironmentFile = ".env.production",
  [switch] $TestRestore
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "backup-support.ps1")

function Assert-DockerExit([string] $Operation) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed with exit code $LASTEXITCODE."
  }
}

function Test-PathWithin([string] $Child, [string] $Parent) {
  $Relative = [System.IO.Path]::GetRelativePath($Parent, $Child)
  return -not [System.IO.Path]::IsPathRooted($Relative) -and
    $Relative -ne ".." -and
    -not $Relative.StartsWith("..$([System.IO.Path]::DirectorySeparatorChar)")
}

function Resolve-ProjectPath([string] $Path, [string] $ProjectRoot) {
  $Candidate = if ([System.IO.Path]::IsPathRooted($Path)) {
    $Path
  } else {
    Join-Path $ProjectRoot $Path
  }
  return (Resolve-Path -LiteralPath $Candidate).Path
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvironmentPath = Resolve-ProjectPath $EnvironmentFile $ProjectRoot
$ResolvedBackup = (Resolve-Path -LiteralPath $BackupDirectory).Path
$ManifestPath = Join-Path $ResolvedBackup "manifest.json"
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  throw "manifest.json is missing."
}

$Manifest = Get-Content -Raw -LiteralPath $ManifestPath -Encoding UTF8 | ConvertFrom-Json
$ManifestVersion = [int] $Manifest.version
if (
  $ManifestVersion -notin @(3, 4) -or
  $Manifest.complete -ne $true -or
  $Manifest.consistency -cne "application-writes-stopped" -or
  $Manifest.backupArtifactsEncrypted -ne $true -or
  $Manifest.encryption.authenticated -ne $true -or
  $Manifest.encryption.algorithm -cne "aes-256-gcm" -or
  $Manifest.encryption.kdf -cne "scrypt" -or
  [string]::IsNullOrWhiteSpace([string] $Manifest.encryption.keyId)
) {
  throw "The manifest does not describe a complete authenticated backup (version 3 or 4)."
}

$DocumentArchiveMetadata = $Manifest.documentArchive
$ExpectedDocumentObjectReferences = 0L
$ArchivedDocumentObjectFiles = 0L
$UnreferencedDocumentObjectFiles = 0L
$ExpectedReferencesValid = $false
if ($null -ne $DocumentArchiveMetadata) {
  $ExpectedReferencesValid = [long]::TryParse(
    [string] $DocumentArchiveMetadata.expectedObjectReferences,
    [ref] $ExpectedDocumentObjectReferences
  )
}
$InventoryValid = $true
if ($ManifestVersion -ge 4 -and $null -ne $DocumentArchiveMetadata) {
  $InventoryValid =
    [long]::TryParse(
      [string] $DocumentArchiveMetadata.archivedObjectFiles,
      [ref] $ArchivedDocumentObjectFiles
    ) -and
    [long]::TryParse(
      [string] $DocumentArchiveMetadata.unreferencedObjectFiles,
      [ref] $UnreferencedDocumentObjectFiles
    ) -and
    $ArchivedDocumentObjectFiles -ge 0 -and
    $UnreferencedDocumentObjectFiles -ge 0 -and
    $ArchivedDocumentObjectFiles -eq (
      $ExpectedDocumentObjectReferences + $UnreferencedDocumentObjectFiles
    ) -and
    $DocumentArchiveMetadata.empty -ne ($ArchivedDocumentObjectFiles -ne 0)
} elseif ($ManifestVersion -ge 4) {
  $InventoryValid = $false
}
if (
  $null -eq $DocumentArchiveMetadata -or
  $DocumentArchiveMetadata.empty -isnot [bool] -or
  -not $ExpectedReferencesValid -or
  $ExpectedDocumentObjectReferences -lt 0 -or
  (
    $DocumentArchiveMetadata.empty -eq $true -and
    (
      $ExpectedDocumentObjectReferences -ne 0 -or
      [string] $DocumentArchiveMetadata.validation -cne "database-confirmed-zero-object-references"
    )
  ) -or
  -not $InventoryValid -or
  (
    $DocumentArchiveMetadata.empty -eq $false -and
    [string] $DocumentArchiveMetadata.validation -cne "volume-contained-files"
  )
) {
  throw "The manifest does not contain a valid document-archive emptiness decision."
}
$DocumentArchiveEmpty = $DocumentArchiveMetadata.empty -eq $true

$Files = @($Manifest.files)
$DatabaseArtifacts = @($Files | Where-Object { $_.kind -eq "database" })
$DocumentArtifacts = @($Files | Where-Object { $_.kind -eq "documents" })
if ($Files.Count -ne 2 -or $DatabaseArtifacts.Count -ne 1 -or $DocumentArtifacts.Count -ne 1) {
  throw "A complete backup must contain exactly one database artifact and one document artifact."
}

foreach ($File in $Files) {
  if (
    [System.IO.Path]::GetFileName([string] $File.name) -ne [string] $File.name -or
    -not ([string] $File.name).EndsWith(".enc", [System.StringComparison]::Ordinal)
  ) {
    throw "Unsafe or unencrypted artifact name in manifest."
  }
  $Path = [System.IO.Path]::GetFullPath((Join-Path $ResolvedBackup ([string] $File.name)))
  if (-not (Test-PathWithin $Path $ResolvedBackup) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Backup artifact is missing or outside its directory: $($File.name)"
  }
  $Item = Get-Item -LiteralPath $Path
  if ($Item.Length -le 0 -or $Item.Length -ne [long] $File.sizeBytes) {
    throw "Invalid artifact size: $($File.name)"
  }
  if ([string] $File.sha256 -notmatch '^[a-f0-9]{64}$') {
    throw "Invalid SHA-256 value in manifest: $($File.name)"
  }
  $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  if ($Hash -cne [string] $File.sha256) {
    throw "Invalid SHA-256 checksum: $($File.name)"
  }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required to authenticate and restore-test backup artifacts."
}

$BackupKey = Get-LydocBackupKey `
  -EnvironmentPath $EnvironmentPath `
  -RequiredKeyId ([string] $Manifest.encryption.keyId)
$DatabaseName = [string] $DatabaseArtifacts[0].name
$DocumentsName = [string] $DocumentArtifacts[0].name
$TemporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("lydoc-backup-verify-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TemporaryDirectory | Out-Null
$PlainDatabase = Join-Path $TemporaryDirectory "database.dump"
$PlainDocuments = Join-Path $TemporaryDirectory "documents.tar.gz"

try {
  Invoke-LydocBackupCrypto `
    -Operation decrypt `
    -InputPath (Join-Path $ResolvedBackup $DatabaseName) `
    -OutputPath $PlainDatabase `
    -Secret $BackupKey.Secret `
    -ScriptsRoot $PSScriptRoot
  Invoke-LydocBackupCrypto `
    -Operation decrypt `
    -InputPath (Join-Path $ResolvedBackup $DocumentsName) `
    -OutputPath $PlainDocuments `
    -Secret $BackupKey.Secret `
    -ScriptsRoot $PSScriptRoot

  $PlainMount = "type=bind,source=$TemporaryDirectory,target=/plain,readonly"
  $InspectionIsolation = Get-LydocContainerIsolationArguments -Memory "256m" -PidsLimit 64
  & docker run --rm @InspectionIsolation --user postgres --mount $PlainMount $LydocPostgresOperatorImage pg_restore --list "/plain/database.dump" 1>$null
  Assert-DockerExit "Inspecting the authenticated PostgreSQL dump"
  $DocumentArchiveEntries = @(
    & docker run --rm @InspectionIsolation --user "65534:65534" --mount $PlainMount $LydocAlpineOperatorImage tar -tzf "/plain/documents.tar.gz"
  )
  Assert-DockerExit "Inspecting the authenticated document archive"
  $DocumentArchiveContainsFiles = @(
    $DocumentArchiveEntries |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace([string] $_) -and
        -not ([string] $_).EndsWith("/", [System.StringComparison]::Ordinal)
      }
  ).Count -gt 0
  if ($DocumentArchiveContainsFiles -eq $DocumentArchiveEmpty) {
    throw "The authenticated document archive does not match its manifest emptiness decision."
  }

  if ($TestRestore) {
    $Suffix = [Guid]::NewGuid().ToString("N").Substring(0, 12)
    $ContainerName = "lydoc-restore-test-$Suffix"
    $DocumentVolumeName = "lydoc-restore-documents-$Suffix"
    $DatabaseVolumeName = "lydoc-restore-database-$Suffix"
    $RemoteDump = "/tmp/database.dump"
    try {
      & docker volume create $DocumentVolumeName 1>$null
      Assert-DockerExit "Creating the temporary document volume"
      & docker volume create $DatabaseVolumeName 1>$null
      Assert-DockerExit "Creating the temporary database volume"
      $VolumeIsolation = Get-LydocContainerIsolationArguments -Memory "128m" -PidsLimit 32
      & docker run --rm @VolumeIsolation `
        --user "0:0" `
        --cap-add CHOWN `
        --mount "type=volume,source=$DatabaseVolumeName,target=/data" `
        $LydocAlpineOperatorImage chown "70:70" /data
      Assert-DockerExit "Preparing the temporary database volume for non-root PostgreSQL"
      $PostgresIsolation = Get-LydocContainerIsolationArguments -Memory "512m" -PidsLimit 128
      & docker run -d --name $ContainerName @PostgresIsolation `
        --user "70:70" `
        --tmpfs "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=70,gid=70,mode=0700" `
        --tmpfs "/var/run/postgresql:rw,nosuid,nodev,size=16m,uid=70,gid=70,mode=0700" `
        --mount "type=volume,source=$DatabaseVolumeName,target=/var/lib/postgresql/data" `
        -e POSTGRES_PASSWORD=restore-test-password `
        $LydocPostgresOperatorImage 1>$null
      Assert-DockerExit "Starting the temporary PostgreSQL server"

      $Ready = $false
      foreach ($Attempt in 1..30) {
        & docker exec $ContainerName pg_isready -U postgres -d postgres 1>$null 2>$null
        if ($LASTEXITCODE -eq 0) {
          $Ready = $true
          break
        }
        Start-Sleep -Seconds 1
      }
      if (-not $Ready) {
        throw "The temporary PostgreSQL server did not become ready."
      }

      & docker cp $PlainDatabase "${ContainerName}:$RemoteDump"
      Assert-DockerExit "Copying the authenticated dump into the temporary server"
      & docker exec $ContainerName pg_restore -U postgres -d postgres --no-owner --no-privileges $RemoteDump
      Assert-DockerExit "Restoring the PostgreSQL dump into the temporary server"
      $TableCount = [int] ((& docker exec $ContainerName psql -U postgres -d postgres -tAc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'" | Select-Object -First 1).Trim())
      Assert-DockerExit "Checking the restored PostgreSQL schema"
      if ($TableCount -lt 1) {
        throw "The restored database contains no public table."
      }
      $RestoredExpectedObjectReferences = Get-LydocExpectedDocumentObjectReferenceCount `
        -PostgresContainer $ContainerName `
        -DatabaseUser "postgres" `
        -DatabaseName "postgres"
      if ($RestoredExpectedObjectReferences -ne $ExpectedDocumentObjectReferences) {
        throw "The restored database object-reference count does not match the backup manifest."
      }

      & docker run --rm @InspectionIsolation `
        --user "0:0" `
        --cap-add CHOWN `
        --mount $PlainMount `
        --mount "type=volume,source=$DocumentVolumeName,target=/restore" `
        $LydocAlpineOperatorImage tar -xzf "/plain/documents.tar.gz" -C /restore
      Assert-DockerExit "Restoring the authenticated document archive into a temporary volume"
      $RestoredDocument = [string] (& docker run --rm @InspectionIsolation --user "1000:1000" --mount "type=volume,source=$DocumentVolumeName,target=/restore,readonly" $LydocAlpineOperatorImage find /restore -type f -print -quit | Select-Object -First 1)
      Assert-DockerExit "Checking the restored document volume"
      if (
        -not $DocumentArchiveEmpty -and
        [string]::IsNullOrWhiteSpace($RestoredDocument)
      ) {
        throw "The restored document volume contains no file."
      }
      if (
        $DocumentArchiveEmpty -and
        -not [string]::IsNullOrWhiteSpace($RestoredDocument)
      ) {
        throw "The restored document volume is not empty as declared by the manifest."
      }
    } finally {
      & docker rm -f $ContainerName 1>$null 2>$null
      & docker volume rm -f $DocumentVolumeName 1>$null 2>$null
      & docker volume rm -f $DatabaseVolumeName 1>$null 2>$null
    }
  }
} finally {
  if (Test-Path -LiteralPath $TemporaryDirectory) {
    Remove-Item -LiteralPath $TemporaryDirectory -Recurse -Force
  }
}

$Mode = if ($TestRestore) { "hashes, authentication and isolated restore" } else { "hashes, authentication and archive structure" }
Write-Host "Backup verified ($Mode): $ResolvedBackup" -ForegroundColor Green
