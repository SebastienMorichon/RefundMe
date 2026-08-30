param(
  [Parameter(Mandatory = $true)]
  [string] $BackupDirectory,
  [string] $ComposeFile = "docker-compose.production.yml",
  [string] $EnvironmentFile = ".env.production",
  [switch] $DatabaseOnly,
  [switch] $DocumentsOnly,
  [switch] $ConfirmRestore
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

function Assert-DockerExit([string] $Operation) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed with exit code $LASTEXITCODE."
  }
}

if (-not $ConfirmRestore) {
  throw "Restore replaces live data. Re-run with -ConfirmRestore after checking the target and backup."
}
if ($DatabaseOnly -and $DocumentsOnly) {
  throw "DatabaseOnly and DocumentsOnly cannot be used together."
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ComposePath = Resolve-ProjectPath $ComposeFile $ProjectRoot
$EnvironmentPath = Resolve-ProjectPath $EnvironmentFile $ProjectRoot
$ResolvedBackup = (Resolve-Path -LiteralPath $BackupDirectory).Path

& (Join-Path $PSScriptRoot "verify-backup.ps1") `
  -BackupDirectory $ResolvedBackup `
  -EnvironmentFile $EnvironmentPath

$Manifest = Get-Content -Raw -LiteralPath (Join-Path $ResolvedBackup "manifest.json") -Encoding UTF8 | ConvertFrom-Json
$DatabaseName = [string] (@($Manifest.files | Where-Object { $_.kind -eq "database" })[0].name)
$DocumentsName = [string] (@($Manifest.files | Where-Object { $_.kind -eq "documents" })[0].name)
$BackupKey = Get-LydocBackupKey `
  -EnvironmentPath $EnvironmentPath `
  -RequiredKeyId ([string] $Manifest.encryption.keyId)
$TemporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("lydoc-restore-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TemporaryDirectory | Out-Null
$PlainDatabase = Join-Path $TemporaryDirectory "database.dump"
$PlainDocuments = Join-Path $TemporaryDirectory "documents.tar.gz"

try {
  if (-not $DocumentsOnly) {
    Invoke-LydocBackupCrypto `
      -Operation decrypt `
      -InputPath (Join-Path $ResolvedBackup $DatabaseName) `
      -OutputPath $PlainDatabase `
      -Secret $BackupKey.Secret `
      -ScriptsRoot $PSScriptRoot
  }
  if (-not $DatabaseOnly) {
    Invoke-LydocBackupCrypto `
      -Operation decrypt `
      -InputPath (Join-Path $ResolvedBackup $DocumentsName) `
      -OutputPath $PlainDocuments `
      -Secret $BackupKey.Secret `
      -ScriptsRoot $PSScriptRoot
  }

  $ComposeArgs = @("compose", "--env-file", $EnvironmentPath, "-f", $ComposePath)
  $PostgresContainer = [string] (& docker @ComposeArgs ps -q postgres | Select-Object -First 1)
  Assert-DockerExit "Locating the PostgreSQL container"
  if ([string]::IsNullOrWhiteSpace($PostgresContainer)) {
    throw "The production PostgreSQL container is not running."
  }
  $PostgresContainer = $PostgresContainer.Trim()

  $DocumentVolume = ""
  if (-not $DatabaseOnly) {
    $ApiContainer = [string] (& docker @ComposeArgs ps -aq api | Select-Object -First 1)
    Assert-DockerExit "Locating the API container"
    if ([string]::IsNullOrWhiteSpace($ApiContainer)) {
      throw "The API container does not exist; the document volume cannot be identified safely."
    }
    $ApiInspect = @(& docker inspect $ApiContainer.Trim() | ConvertFrom-Json)[0]
    Assert-DockerExit "Inspecting the API container"
    $DocumentMount = @($ApiInspect.Mounts | Where-Object { $_.Destination -eq "/app/var/storage" })
    if ($DocumentMount.Count -ne 1 -or $DocumentMount[0].Type -ne "volume") {
      throw "The API document storage is not backed by exactly one Docker volume."
    }
    $DocumentVolume = [string] $DocumentMount[0].Name
  }

  Write-Host "Stopping API and web before restore..." -ForegroundColor Yellow
  & docker @ComposeArgs stop api web
  Assert-DockerExit "Stopping application services"

  try {
    if (-not $DocumentsOnly) {
      $RemoteDump = "/tmp/database.dump"
      try {
        & docker cp $PlainDatabase "${PostgresContainer}:$RemoteDump"
        Assert-DockerExit "Copying the authenticated database dump"
        & docker exec $PostgresContainer pg_restore -U lydoc -d lydoc --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction $RemoteDump
        Assert-DockerExit "Restoring PostgreSQL atomically"
      } finally {
        & docker exec $PostgresContainer rm -f $RemoteDump 1>$null 2>$null
      }
    }

    if (-not $DatabaseOnly) {
      $PlainMount = "type=bind,source=$TemporaryDirectory,target=/plain,readonly"
      $RestoreIsolation = Get-LydocContainerIsolationArguments -Memory "256m" -PidsLimit 64
      & docker run --rm @RestoreIsolation `
        --user "0:0" `
        --mount "type=volume,source=$DocumentVolume,target=/target" `
        $LydocAlpineOperatorImage find /target -mindepth 1 -delete
      Assert-DockerExit "Clearing the identified document volume"
      & docker run --rm @RestoreIsolation `
        --user "0:0" `
        --cap-add CHOWN `
        --mount $PlainMount `
        --mount "type=volume,source=$DocumentVolume,target=/target" `
        $LydocAlpineOperatorImage tar -xzf "/plain/documents.tar.gz" -C /target
      Assert-DockerExit "Restoring the authenticated document archive"
    }

    & docker @ComposeArgs up -d postgres migrate api web
    Assert-DockerExit "Restarting the production stack"
  } catch {
    Write-Error "Restore failed. API and web remain stopped to prevent use of partially restored data. $($_.Exception.Message)"
    throw
  }
} finally {
  if (Test-Path -LiteralPath $TemporaryDirectory) {
    Remove-Item -LiteralPath $TemporaryDirectory -Recurse -Force
  }
}

Write-Host "Restore completed and production services restarted." -ForegroundColor Green
