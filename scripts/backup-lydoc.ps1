param(
  [string] $Destination = "",
  [int] $KeepDays = 30,
  [string] $ComposeFile = "docker-compose.production.yml",
  [string] $EnvironmentFile = ".env.production",
  [switch] $AllowExternalDestination
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "backup-support.ps1")

function Resolve-ProjectPath([string] $Path, [string] $ProjectRoot) {
  $Candidate = if ([System.IO.Path]::IsPathRooted($Path)) {
    $Path
  } else {
    Join-Path $ProjectRoot $Path
  }
  return (Resolve-Path -LiteralPath $Candidate).Path
}

function Test-PathWithin([string] $Child, [string] $Parent) {
  $Relative = [System.IO.Path]::GetRelativePath($Parent, $Child)
  return -not [System.IO.Path]::IsPathRooted($Relative) -and
    $Relative -ne ".." -and
    -not $Relative.StartsWith("..$([System.IO.Path]::DirectorySeparatorChar)")
}

function Assert-LastExitCode([string] $Operation) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed with exit code $LASTEXITCODE."
  }
}

function Test-ContainerRunning([string] $Container) {
  $State = [string] (& docker inspect --format "{{.State.Running}}" $Container | Select-Object -First 1)
  Assert-LastExitCode "Inspecting container state"
  return $State.Trim() -eq "true"
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ComposePath = Resolve-ProjectPath $ComposeFile $ProjectRoot
$EnvironmentPath = Resolve-ProjectPath $EnvironmentFile $ProjectRoot

if ($KeepDays -lt 1) {
  throw "KeepDays must be greater than or equal to 1."
}

if (-not $Destination) {
  $Destination = Join-Path $ProjectRoot "var\backups"
}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$ResolvedDestination = (Resolve-Path -LiteralPath $Destination).Path
if (-not $AllowExternalDestination -and -not (Test-PathWithin $ResolvedDestination $ProjectRoot)) {
  throw "The backup destination must remain inside the project unless -AllowExternalDestination is explicit."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required to back up the production volumes."
}

$BackupKey = Get-LydocBackupKey -EnvironmentPath $EnvironmentPath
$ComposeArgs = @("compose", "--env-file", $EnvironmentPath, "-f", $ComposePath)
$PostgresContainer = [string] (& docker @ComposeArgs ps -q postgres | Select-Object -First 1)
Assert-LastExitCode "Locating the PostgreSQL container"
if ([string]::IsNullOrWhiteSpace($PostgresContainer)) {
  throw "The production PostgreSQL container is not running."
}
$PostgresContainer = $PostgresContainer.Trim()

$ApiContainer = [string] (& docker @ComposeArgs ps -aq api | Select-Object -First 1)
Assert-LastExitCode "Locating the API container"
if ([string]::IsNullOrWhiteSpace($ApiContainer)) {
  throw "The API container does not exist; the document volume cannot be identified safely."
}
$ApiContainer = $ApiContainer.Trim()
$ApiInspect = @(& docker inspect $ApiContainer | ConvertFrom-Json)[0]
Assert-LastExitCode "Inspecting the API container"
$DocumentMount = @($ApiInspect.Mounts | Where-Object { $_.Destination -eq "/app/var/storage" })
if ($DocumentMount.Count -ne 1 -or $DocumentMount[0].Type -ne "volume") {
  throw "The API document storage is not backed by exactly one Docker volume."
}
$DocumentVolume = [string] $DocumentMount[0].Name

$ServicesToRestart = [System.Collections.Generic.List[string]]::new()
if (Test-ContainerRunning $ApiContainer) {
  $ServicesToRestart.Add("api")
}
$WebContainer = [string] (& docker @ComposeArgs ps -aq web | Select-Object -First 1)
Assert-LastExitCode "Locating the web container"
if (-not [string]::IsNullOrWhiteSpace($WebContainer) -and (Test-ContainerRunning $WebContainer.Trim())) {
  $ServicesToRestart.Add("web")
}

if ($ServicesToRestart.Count -gt 0) {
  Write-Host "Entering backup maintenance mode (API/Web writes stopped)..." -ForegroundColor Yellow
  & docker @ComposeArgs stop @ServicesToRestart
  Assert-LastExitCode "Stopping application services for a coherent backup"
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDirectory = Join-Path $ResolvedDestination $Timestamp
$DumpName = "database-$Timestamp.dump"
$StorageName = "documents-$Timestamp.tar.gz"
$EncryptedDumpName = "$DumpName.enc"
$EncryptedStorageName = "$StorageName.enc"
$LocalDump = Join-Path $BackupDirectory $DumpName
$LocalStorage = Join-Path $BackupDirectory $StorageName

try {
  $IsolationArgs = Get-LydocContainerIsolationArguments -Memory "128m" -PidsLimit 32
  $DocumentFiles = @(
    & docker run --rm @IsolationArgs --user "1000:1000" --mount "type=volume,source=$DocumentVolume,target=/source,readonly" $LydocAlpineOperatorImage find /source -type f -print
  )
  Assert-LastExitCode "Inspecting the document volume in maintenance mode"
  $DocumentObjectReferences = @(
    $DocumentFiles |
      ForEach-Object { ([string] $_).Trim() } |
      Where-Object { $_.StartsWith("/source/") } |
      ForEach-Object { $_.Substring("/source/".Length) }
  )
  $DocumentArchiveEmpty = $DocumentObjectReferences.Count -eq 0
  $ExpectedDocumentObjects = @(
    Get-LydocExpectedDocumentObjectReferences `
      -PostgresContainer $PostgresContainer `
      -DatabaseUser "lydoc" `
      -DatabaseName "lydoc"
  )
  $ExpectedDocumentObjectReferences = $ExpectedDocumentObjects.Count
  $MissingDocumentObjects = @(
    $ExpectedDocumentObjects |
      Where-Object { $_ -cnotin $DocumentObjectReferences }
  )
  if ($MissingDocumentObjects.Count -gt 0) {
    throw "The document volume is missing $($MissingDocumentObjects.Count) database-referenced object(s). Refusing an incomplete backup."
  }
  $UnreferencedDocumentObjectCount = @(
    $DocumentObjectReferences |
      Where-Object { $_ -cnotin $ExpectedDocumentObjects }
  ).Count
  $DocumentArchiveValidation = Assert-LydocDocumentArchiveState `
    -ArchiveEmpty $DocumentArchiveEmpty `
    -ExpectedObjectReferences $ExpectedDocumentObjectReferences

  New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
  $RemoteDump = "/tmp/$DumpName"
  try {
    & docker exec $PostgresContainer pg_dump -U lydoc -d lydoc -Fc -f $RemoteDump
    Assert-LastExitCode "Creating the PostgreSQL dump"
    & docker cp "${PostgresContainer}:$RemoteDump" $LocalDump
    Assert-LastExitCode "Copying the PostgreSQL dump"
  } finally {
    & docker exec $PostgresContainer rm -f $RemoteDump 1>$null 2>$null
  }

  & docker run --rm @IsolationArgs `
    --user "1000:1000" `
    --mount "type=volume,source=$DocumentVolume,target=/source,readonly" `
    --mount "type=bind,source=$BackupDirectory,target=/backup" `
    $LydocAlpineOperatorImage tar -czf "/backup/$StorageName" -C /source .
  Assert-LastExitCode "Archiving the document volume"

  try {
    Invoke-LydocBackupCrypto `
      -Operation encrypt `
      -InputPath $LocalDump `
      -OutputPath (Join-Path $BackupDirectory $EncryptedDumpName) `
      -Secret $BackupKey.Secret `
      -ScriptsRoot $PSScriptRoot
    Invoke-LydocBackupCrypto `
      -Operation encrypt `
      -InputPath $LocalStorage `
      -OutputPath (Join-Path $BackupDirectory $EncryptedStorageName) `
      -Secret $BackupKey.Secret `
      -ScriptsRoot $PSScriptRoot
  } finally {
    Remove-Item -LiteralPath $LocalDump -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $LocalStorage -Force -ErrorAction SilentlyContinue
  }

  $Files = @(
    @{ kind = "database"; path = (Join-Path $BackupDirectory $EncryptedDumpName) },
    @{ kind = "documents"; path = (Join-Path $BackupDirectory $EncryptedStorageName) }
  ) | ForEach-Object {
    $Item = Get-Item -LiteralPath $_.path
    if ($Item.Length -le 0) {
      throw "Backup artifact is empty: $($Item.Name)"
    }
    $Hash = Get-FileHash -Algorithm SHA256 -LiteralPath $Item.FullName
    [ordered]@{
      kind = $_.kind
      name = $Item.Name
      sizeBytes = $Item.Length
      sha256 = $Hash.Hash.ToLowerInvariant()
    }
  }

  $Manifest = [ordered]@{
    version = 4
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    consistency = "application-writes-stopped"
    composeFile = [System.IO.Path]::GetFileName($ComposePath)
    database = "postgresql"
    documentVolume = $DocumentVolume
    documentArchive = [ordered]@{
      empty = $DocumentArchiveEmpty
      expectedObjectReferences = $ExpectedDocumentObjectReferences
      archivedObjectFiles = $DocumentObjectReferences.Count
      unreferencedObjectFiles = $UnreferencedDocumentObjectCount
      validation = $DocumentArchiveValidation
    }
    documentVolumeEncryptedAtRest = $true
    backupArtifactsEncrypted = $true
    encryption = [ordered]@{
      algorithm = "aes-256-gcm"
      kdf = "scrypt"
      keyId = $BackupKey.KeyId
      authenticated = $true
    }
    complete = $true
    files = @($Files)
  }
  $Manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $BackupDirectory "manifest.json") -Encoding UTF8
} finally {
  Remove-Item -LiteralPath $LocalDump -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $LocalStorage -Force -ErrorAction SilentlyContinue
  if ($ServicesToRestart.Count -gt 0) {
    & docker @ComposeArgs start @ServicesToRestart
    Assert-LastExitCode "Leaving backup maintenance mode"
  }
}

$Cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -LiteralPath $ResolvedDestination -Directory |
  Where-Object {
    $_.CreationTime -lt $Cutoff -and
    (Test-PathWithin $_.FullName $ResolvedDestination) -and
    $_.FullName -ne $BackupDirectory
  } |
  Remove-Item -Recurse -Force

Write-Host "Complete coherent Lydoc backup created: $BackupDirectory" -ForegroundColor Green
