$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SourceEnvironment = Join-Path $ProjectRoot "deploy\production.env.example"
$Preflight = Join-Path $PSScriptRoot "preflight-production.ps1"
$ComposeFile = Join-Path $ProjectRoot "docker-compose.production.yml"
$TemporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "lydoc-preflight-$([Guid]::NewGuid().ToString('N'))"
$TemporaryEnvironment = Join-Path $TemporaryDirectory "production.env"

$Replacements = [ordered] @{
  POSTGRES_PASSWORD                   = "ci-database-password-0000000000000001"
  DATABASE_URL                       = "postgresql://lydoc:ci-database-password-0000000000000001@postgres:5432/lydoc"
  APP_URL                            = "https://app.lydoc.test"
  API_URL                            = "https://api.lydoc.test"
  NEXT_PUBLIC_APP_URL                = "https://app.lydoc.test"
  NEXT_PUBLIC_API_URL                = "https://api.lydoc.test"
  SECURITY_CONTACT_EMAIL             = "security@lydoc.test"
  TRUST_PROXY_CIDRS                  = "172.20.0.1/32"
  SESSION_SECRET                     = "ci-session-secret-000000000000000001"
  IDENTITY_OUTBOX_ENCRYPTION_SECRET  = "ci-outbox-secret-000000000000000001"
  MFA_ENCRYPTION_SECRET              = "ci-mfa-secret-000000000000000000001"
  DOCUMENT_ENCRYPTION_SECRET         = "ci-document-secret-0000000000000001"
  BACKUP_ENCRYPTION_SECRET           = "ci-backup-secret-000000000000000001"
  MISTRAL_API_KEY                    = "mistral-ci-key-0000000000"
  RESEND_API_KEY                     = "re_ci_key_0000000000"
  RESEND_FROM_EMAIL                  = "Lydoc <notifications@lydoc.test>"
  CONTACT_TO_EMAIL                   = "support@lydoc.test"
}

try {
  New-Item -ItemType Directory -Path $TemporaryDirectory | Out-Null
  $Content = Get-Content -LiteralPath $SourceEnvironment -Raw -Encoding UTF8
  foreach ($Entry in $Replacements.GetEnumerator()) {
    $Pattern = "(?m)^$([Regex]::Escape([string] $Entry.Key))=.*$"
    if (-not [Regex]::IsMatch($Content, $Pattern)) {
      throw "Missing production environment fixture key: $($Entry.Key)."
    }
    $Content = [Regex]::Replace(
      $Content,
      $Pattern,
      "$($Entry.Key)=$($Entry.Value)"
    )
  }
  [System.IO.File]::WriteAllText(
    $TemporaryEnvironment,
    $Content,
    [System.Text.UTF8Encoding]::new($false)
  )

  & $Preflight `
    -EnvironmentFile $TemporaryEnvironment `
    -ComposeFile $ComposeFile `
    -ExpectedProfile "free-beta"
  Write-Host "Production preflight regression test passed." -ForegroundColor Green
} finally {
  if (Test-Path -LiteralPath $TemporaryDirectory) {
    Remove-Item -LiteralPath $TemporaryDirectory -Recurse -Force
  }
}
