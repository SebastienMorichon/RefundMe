param(
  [string] $EnvironmentFile = ".env.production",
  [string] $ComposeFile = "docker-compose.production.yml",
  [ValidateSet("free-beta", "full")]
  [string] $ExpectedProfile = "free-beta",
  [switch] $AllowPublicBind
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-InputPath([string] $Path, [string] $BasePath) {
  $Candidate = if ([System.IO.Path]::IsPathRooted($Path)) {
    $Path
  } else {
    Join-Path $BasePath $Path
  }
  return (Resolve-Path -LiteralPath $Candidate).Path
}

function Read-DotEnv([string] $Path) {
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

function Test-Placeholder([string] $Value) {
  return $Value -match '(?i)(change[_-]?me|replace-with|example\.(com|invalid)|your[-_])'
}

function Require-Value([hashtable] $Values, [string] $Name, [System.Collections.Generic.List[string]] $Invalid) {
  $Value = [string] $Values[$Name]
  if ([string]::IsNullOrWhiteSpace($Value) -or (Test-Placeholder $Value)) {
    $Invalid.Add($Name)
  }
}

function Require-Secret([hashtable] $Values, [string] $Name, [int] $MinimumLength, [System.Collections.Generic.List[string]] $Invalid) {
  $Value = [string] $Values[$Name]
  if ($Value.Length -lt $MinimumLength -or (Test-Placeholder $Value)) {
    $Invalid.Add($Name)
  }
}

function Require-Exact([hashtable] $Values, [string] $Name, [string] $Expected, [System.Collections.Generic.List[string]] $Invalid) {
  if ([string] $Values[$Name] -cne $Expected) {
    $Invalid.Add($Name)
  }
}

function Require-Boolean([hashtable] $Values, [string] $Name, [System.Collections.Generic.List[string]] $Invalid) {
  if ([string] $Values[$Name] -notin @("true", "false")) {
    $Invalid.Add($Name)
  }
}

function Require-HttpsUrl([hashtable] $Values, [string] $Name, [System.Collections.Generic.List[string]] $Invalid) {
  $Value = [string] $Values[$Name]
  try {
    $Uri = [System.Uri] $Value
    if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -ne "https" -or (Test-Placeholder $Value)) {
      $Invalid.Add($Name)
    }
  } catch {
    $Invalid.Add($Name)
  }
}

function Require-Email([hashtable] $Values, [string] $Name, [System.Collections.Generic.List[string]] $Invalid) {
  $Value = [string] $Values[$Name]
  try {
    $Address = [System.Net.Mail.MailAddress]::new($Value)
    if ($Address.Address -cne $Value -or (Test-Placeholder $Value)) {
      $Invalid.Add($Name)
    }
  } catch {
    $Invalid.Add($Name)
  }
}

function Validate-DailyLimit([hashtable] $Values, [System.Collections.Generic.List[string]] $Invalid) {
  $Raw = [string] $Values["CONTACT_DAILY_LIMIT"]
  if ([string]::IsNullOrWhiteSpace($Raw)) { return }
  $Limit = 0
  if (-not [int]::TryParse($Raw, [ref] $Limit) -or $Limit -lt 1 -or $Limit -gt 10000) {
    $Invalid.Add("CONTACT_DAILY_LIMIT")
  }
}

function Require-IntegerRange(
  [hashtable] $Values,
  [string] $Name,
  [long] $Minimum,
  [long] $Maximum,
  [System.Collections.Generic.List[string]] $Invalid
) {
  $Raw = [string] $Values[$Name]
  [long] $Number = 0
  if (
    [string]::IsNullOrWhiteSpace($Raw) -or
    -not [long]::TryParse($Raw, [ref] $Number) -or
    $Number -lt $Minimum -or
    $Number -gt $Maximum
  ) {
    $Invalid.Add($Name)
  }
}

function Validate-TrustedProxy([hashtable] $Values, [System.Collections.Generic.List[string]] $Invalid) {
  Require-Boolean $Values "TRUST_PROXY" $Invalid
  if ($Values["TRUST_PROXY"] -ne "true") {
    if (-not $Invalid.Contains("TRUST_PROXY")) { $Invalid.Add("TRUST_PROXY") }
    return
  }
  $Cidrs = @(([string] $Values["TRUST_PROXY_CIDRS"]).Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if (
    $Cidrs.Count -lt 1 -or
    $Cidrs.Count -gt 16 -or
    @($Cidrs | Where-Object { -not (Test-ExactProxyHost $_) }).Count -gt 0
  ) {
    $Invalid.Add("TRUST_PROXY_CIDRS")
  }
}

function Test-ExactProxyHost([string] $Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Contains("%")) {
    return $false
  }
  $Parts = @($Value.Split("/"))
  if ($Parts.Count -lt 1 -or $Parts.Count -gt 2) { return $false }
  $AddressText = $Parts[0]
  if (
    $AddressText.Contains(".") -and
    $AddressText -notmatch '^(?:\d{1,3}\.){3}\d{1,3}$'
  ) {
    return $false
  }
  $Address = $null
  if (-not [System.Net.IPAddress]::TryParse($AddressText, [ref] $Address)) {
    return $false
  }
  if (
    $Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
    $Address.ToString() -cne $AddressText
  ) {
    return $false
  }
  $AddressBytes = $Address.GetAddressBytes()
  if (
    $Address.Equals([System.Net.IPAddress]::Any) -or
    $Address.Equals([System.Net.IPAddress]::IPv6Any) -or
    $Address.Equals([System.Net.IPAddress]::Broadcast) -or
    (
      $Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
      $AddressBytes[0] -ge 224 -and
      $AddressBytes[0] -le 239
    ) -or
    (
      $Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6 -and
      $AddressBytes[0] -eq 255
    )
  ) {
    return $false
  }
  if ($Parts.Count -eq 1) { return $true }
  $ExpectedPrefix = if (
    $Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork
  ) { 32 } else { 128 }
  $Prefix = 0
  return [int]::TryParse($Parts[1], [ref] $Prefix) -and $Prefix -eq $ExpectedPrefix
}

function Validate-DatabaseUrl([hashtable] $Values, [System.Collections.Generic.List[string]] $Invalid) {
  try {
    $Uri = [System.Uri] ([string] $Values["DATABASE_URL"])
    if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -notin @("postgres", "postgresql") -or $Uri.Host -ne "postgres") {
      $Invalid.Add("DATABASE_URL")
    }
  } catch {
    $Invalid.Add("DATABASE_URL")
  }
}

function Validate-PreviousEncryptionKeys([hashtable] $Values, [System.Collections.Generic.List[string]] $Invalid) {
  $Raw = [string] $Values["DOCUMENT_ENCRYPTION_PREVIOUS_KEYS"]
  if ([string]::IsNullOrWhiteSpace($Raw)) { return }
  try {
    $Keyring = $Raw | ConvertFrom-Json
    if (
      $null -eq $Keyring -or
      $Keyring -is [array] -or
      $Keyring -is [string] -or
      $Keyring -is [ValueType]
    ) {
      $Invalid.Add("DOCUMENT_ENCRYPTION_PREVIOUS_KEYS")
      return
    }
    foreach ($Entry in $Keyring.PSObject.Properties) {
      $Secret = [string] $Entry.Value
      if (
        [string]::IsNullOrWhiteSpace($Entry.Name) -or
        $Entry.Name -eq [string] $Values["DOCUMENT_ENCRYPTION_KEY_ID"] -or
        $Secret.Length -lt 32 -or
        (Test-Placeholder $Secret)
      ) {
        $Invalid.Add("DOCUMENT_ENCRYPTION_PREVIOUS_KEYS")
        return
      }
    }
  } catch {
    $Invalid.Add("DOCUMENT_ENCRYPTION_PREVIOUS_KEYS")
  }
}

function Validate-PreviousBackupKeys([hashtable] $Values, [System.Collections.Generic.List[string]] $Invalid) {
  $Raw = [string] $Values["BACKUP_ENCRYPTION_PREVIOUS_KEYS"]
  if ([string]::IsNullOrWhiteSpace($Raw)) { return }
  try {
    $Keyring = $Raw | ConvertFrom-Json
    if (
      $null -eq $Keyring -or
      $Keyring -is [array] -or
      $Keyring -is [string] -or
      $Keyring -is [ValueType]
    ) {
      $Invalid.Add("BACKUP_ENCRYPTION_PREVIOUS_KEYS")
      return
    }
    foreach ($Entry in $Keyring.PSObject.Properties) {
      $Secret = [string] $Entry.Value
      if (
        [string]::IsNullOrWhiteSpace($Entry.Name) -or
        $Entry.Name -eq [string] $Values["BACKUP_ENCRYPTION_KEY_ID"] -or
        $Secret.Length -lt 32 -or
        $Secret -eq [string] $Values["DOCUMENT_ENCRYPTION_SECRET"] -or
        (Test-Placeholder $Secret)
      ) {
        $Invalid.Add("BACKUP_ENCRYPTION_PREVIOUS_KEYS")
        return
      }
    }
  } catch {
    $Invalid.Add("BACKUP_ENCRYPTION_PREVIOUS_KEYS")
  }
}

function Validate-PreviousMfaKeys([hashtable] $Values, [System.Collections.Generic.List[string]] $Invalid) {
  $Raw = [string] $Values["MFA_ENCRYPTION_PREVIOUS_KEYS"]
  if ([string]::IsNullOrWhiteSpace($Raw)) { return }
  try {
    $Keyring = $Raw | ConvertFrom-Json
    if (
      $null -eq $Keyring -or
      $Keyring -is [array] -or
      $Keyring -is [string] -or
      $Keyring -is [ValueType]
    ) {
      $Invalid.Add("MFA_ENCRYPTION_PREVIOUS_KEYS")
      return
    }
    foreach ($Entry in $Keyring.PSObject.Properties) {
      $Secret = [string] $Entry.Value
      if (
        $Entry.Name -notmatch '^[A-Za-z0-9_-]{1,48}$' -or
        $Entry.Name -eq [string] $Values["MFA_ENCRYPTION_KEY_ID"] -or
        $Secret.Length -lt 32 -or
        $Secret -eq [string] $Values["SESSION_SECRET"] -or
        $Secret -eq [string] $Values["DOCUMENT_ENCRYPTION_SECRET"] -or
        $Secret -eq [string] $Values["BACKUP_ENCRYPTION_SECRET"] -or
        (Test-Placeholder $Secret)
      ) {
        $Invalid.Add("MFA_ENCRYPTION_PREVIOUS_KEYS")
        return
      }
    }
  } catch {
    $Invalid.Add("MFA_ENCRYPTION_PREVIOUS_KEYS")
  }
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvironmentPath = Resolve-InputPath $EnvironmentFile $ProjectRoot
$ComposePath = Resolve-InputPath $ComposeFile $ProjectRoot
$Configuration = Read-DotEnv $EnvironmentPath
$Invalid = [System.Collections.Generic.List[string]]::new()

Require-Exact $Configuration "LYDOC_DEPLOYMENT_PROFILE" $ExpectedProfile $Invalid
Require-Secret $Configuration "POSTGRES_PASSWORD" 24 $Invalid
Require-Secret $Configuration "SESSION_SECRET" 32 $Invalid
Require-Secret $Configuration "IDENTITY_OUTBOX_ENCRYPTION_SECRET" 32 $Invalid
Require-Secret $Configuration "MFA_ENCRYPTION_SECRET" 32 $Invalid
Require-Value $Configuration "MFA_ENCRYPTION_KEY_ID" $Invalid
if ([string] $Configuration["MFA_ENCRYPTION_KEY_ID"] -notmatch '^[A-Za-z0-9_-]{1,48}$') {
  $Invalid.Add("MFA_ENCRYPTION_KEY_ID")
}
Validate-PreviousMfaKeys $Configuration $Invalid
Require-Secret $Configuration "DOCUMENT_ENCRYPTION_SECRET" 32 $Invalid
Require-Value $Configuration "DOCUMENT_ENCRYPTION_KEY_ID" $Invalid
Validate-PreviousEncryptionKeys $Configuration $Invalid
Require-Secret $Configuration "BACKUP_ENCRYPTION_SECRET" 32 $Invalid
Require-Value $Configuration "BACKUP_ENCRYPTION_KEY_ID" $Invalid
Validate-PreviousBackupKeys $Configuration $Invalid
if ($Configuration["BACKUP_ENCRYPTION_SECRET"] -eq $Configuration["DOCUMENT_ENCRYPTION_SECRET"]) {
  $Invalid.Add("BACKUP_ENCRYPTION_SECRET (must be independent from document encryption)")
}
if (
  $Configuration["MFA_ENCRYPTION_SECRET"] -eq $Configuration["SESSION_SECRET"] -or
  $Configuration["MFA_ENCRYPTION_SECRET"] -eq $Configuration["DOCUMENT_ENCRYPTION_SECRET"] -or
  $Configuration["MFA_ENCRYPTION_SECRET"] -eq $Configuration["BACKUP_ENCRYPTION_SECRET"]
) {
  $Invalid.Add("MFA_ENCRYPTION_SECRET (must be independent)")
}
if (
  $Configuration["IDENTITY_OUTBOX_ENCRYPTION_SECRET"] -eq $Configuration["SESSION_SECRET"] -or
  $Configuration["IDENTITY_OUTBOX_ENCRYPTION_SECRET"] -eq $Configuration["MFA_ENCRYPTION_SECRET"] -or
  $Configuration["IDENTITY_OUTBOX_ENCRYPTION_SECRET"] -eq $Configuration["DOCUMENT_ENCRYPTION_SECRET"] -or
  $Configuration["IDENTITY_OUTBOX_ENCRYPTION_SECRET"] -eq $Configuration["BACKUP_ENCRYPTION_SECRET"]
) {
  $Invalid.Add("IDENTITY_OUTBOX_ENCRYPTION_SECRET (must be independent)")
}
Require-IntegerRange $Configuration "ADMIN_SESSION_TTL_MINUTES" 5 60 $Invalid
Require-IntegerRange $Configuration "AUTH_SCRYPT_CONCURRENCY" 1 8 $Invalid
Require-IntegerRange $Configuration "AUTH_SCRYPT_QUEUE_LIMIT" 1 100 $Invalid
Require-IntegerRange $Configuration "AUTH_EMAIL_DAILY_GLOBAL_LIMIT" 1 100000 $Invalid
Require-IntegerRange $Configuration "AUTH_REGISTER_HOURLY_GLOBAL_LIMIT" 1 10000 $Invalid
Require-IntegerRange $Configuration "AUTH_RESEND_HOURLY_GLOBAL_LIMIT" 1 10000 $Invalid
Require-IntegerRange $Configuration "AUTH_FORGOT_HOURLY_GLOBAL_LIMIT" 1 10000 $Invalid
Require-IntegerRange $Configuration "AUTH_MFA_CHALLENGE_HOURLY_GLOBAL_LIMIT" 1 10000 $Invalid
Require-IntegerRange $Configuration "AUTH_REGISTER_HOURLY_IDENTIFIER_LIMIT" 1 1000 $Invalid
Require-IntegerRange $Configuration "AUTH_RESEND_HOURLY_IDENTIFIER_LIMIT" 1 1000 $Invalid
Require-IntegerRange $Configuration "AUTH_FORGOT_HOURLY_IDENTIFIER_LIMIT" 1 1000 $Invalid
Require-IntegerRange $Configuration "AUTH_MFA_CHALLENGE_HOURLY_IDENTIFIER_LIMIT" 1 1000 $Invalid
Require-IntegerRange $Configuration "AUTH_DISPATCH_MIN_RESPONSE_MS" 100 1000 $Invalid
Require-IntegerRange $Configuration "AUTH_PENDING_USER_TTL_HOURS" 1 720 $Invalid
Require-IntegerRange $Configuration "AUTH_CLEANUP_INTERVAL_MINUTES" 5 1440 $Invalid
Require-Exact $Configuration "AUTH_EXPOSE_TEST_TOKENS" "false" $Invalid
Require-IntegerRange $Configuration "IDENTITY_EMAIL_OUTBOX_INTERVAL_MS" 250 60000 $Invalid
Require-IntegerRange $Configuration "IDENTITY_EMAIL_OUTBOX_CONCURRENCY" 1 5 $Invalid
Require-IntegerRange $Configuration "IDENTITY_EMAIL_OUTBOX_BATCH_SIZE" 1 50 $Invalid
Require-IntegerRange $Configuration "IDENTITY_EMAIL_OUTBOX_LEASE_SECONDS" 30 600 $Invalid
Require-IntegerRange $Configuration "IDENTITY_EMAIL_OUTBOX_MAX_ATTEMPTS" 1 20 $Invalid
Require-Secret $Configuration "MISTRAL_API_KEY" 12 $Invalid
Require-Secret $Configuration "RESEND_API_KEY" 8 $Invalid
if (-not ([string] $Configuration["RESEND_API_KEY"]).StartsWith("re_", [System.StringComparison]::Ordinal)) {
  $Invalid.Add("RESEND_API_KEY")
}
Require-Value $Configuration "RESEND_FROM_EMAIL" $Invalid
Require-Email $Configuration "CONTACT_TO_EMAIL" $Invalid
Require-Email $Configuration "SECURITY_CONTACT_EMAIL" $Invalid
Validate-DailyLimit $Configuration $Invalid
Require-IntegerRange $Configuration "CONTACT_DAILY_EMAIL_LIMIT" 1 20 $Invalid
Require-IntegerRange $Configuration "CONTACT_DAILY_CLIENT_LIMIT" 1 200 $Invalid
Require-IntegerRange $Configuration "CONTACT_HOURLY_ATTEMPT_LIMIT" 1 10000 $Invalid
Require-IntegerRange $Configuration "CONTACT_HOURLY_EMAIL_ATTEMPT_LIMIT" 1 100 $Invalid
Require-IntegerRange $Configuration "CONTACT_HOURLY_CLIENT_ATTEMPT_LIMIT" 1 1000 $Invalid
Require-HttpsUrl $Configuration "APP_URL" $Invalid
Require-HttpsUrl $Configuration "API_URL" $Invalid
Require-HttpsUrl $Configuration "NEXT_PUBLIC_APP_URL" $Invalid
Require-HttpsUrl $Configuration "NEXT_PUBLIC_API_URL" $Invalid
Validate-TrustedProxy $Configuration $Invalid
Require-IntegerRange $Configuration "API_GENERAL_RATE_LIMIT_PER_MINUTE" 10 10000 $Invalid
Require-IntegerRange $Configuration "AI_DAILY_ACCOUNT_CALL_LIMIT" 0 1000 $Invalid
Require-IntegerRange $Configuration "MISTRAL_DAILY_CALL_LIMIT" 0 100000 $Invalid
Require-IntegerRange $Configuration "MISTRAL_MAX_CONCURRENT_REQUESTS" 1 20 $Invalid
Require-IntegerRange $Configuration "AI_LOCAL_DLP_CONCURRENCY" 1 8 $Invalid
Require-IntegerRange $Configuration "AI_LOCAL_DLP_MAX_PAGES" 1 20 $Invalid
Require-IntegerRange $Configuration "DOCUMENT_PENDING_UPLOAD_GLOBAL_BYTES" 20971520 2000000000 $Invalid
Require-IntegerRange $Configuration "DOCUMENT_UPLOAD_CONCURRENCY_GLOBAL" 1 32 $Invalid
Require-IntegerRange $Configuration "DOCUMENT_UPLOAD_CONCURRENCY_ACCOUNT" 1 8 $Invalid
Require-IntegerRange $Configuration "STORAGE_WRITE_RESERVATION_TTL_SECONDS" 60 3600 $Invalid
Require-IntegerRange $Configuration "DOCUMENT_STORAGE_MIN_FREE_BYTES" 104857600 100000000000000 $Invalid
Require-IntegerRange $Configuration "DOCUMENT_STORAGE_GLOBAL_BYTES" 1073741824 1000000000000000 $Invalid
Require-IntegerRange $Configuration "DOCUMENT_RETENTION_DAYS" 1 3650 $Invalid
Require-IntegerRange $Configuration "SENSITIVE_DOCUMENT_RETENTION_DAYS" 1 3650 $Invalid
Require-IntegerRange $Configuration "DOCUMENT_DELETION_GRACE_DAYS" 1 365 $Invalid
Require-IntegerRange $Configuration "DOCUMENT_MIGRATION_BACKUP_DAYS" 1 365 $Invalid
Require-Exact $Configuration "DOCUMENT_RETENTION_AUTOMATION_ENABLED" "true" $Invalid
Require-IntegerRange $Configuration "DOCUMENT_RETENTION_INTERVAL_MINUTES" 1 1440 $Invalid
Require-IntegerRange $Configuration "ACCOUNT_ERASURE_PURGE_GRACE_DAYS" 0 30 $Invalid
Require-IntegerRange $Configuration "ACCOUNT_LEGAL_RECORD_RETENTION_DAYS" 365 4000 $Invalid
Require-Exact $Configuration "SERVICE_POSTAL_ALLOW_LEGACY_WEBHOOK_TOKEN" "false" $Invalid
Require-IntegerRange $Configuration "SERVICE_POSTAL_WEBHOOK_TOLERANCE_SECONDS" 1 3600 $Invalid
Require-IntegerRange $Configuration "SERVICE_POSTAL_REQUEST_TIMEOUT_MS" 1000 30000 $Invalid
Require-IntegerRange $Configuration "SERVICE_POSTAL_REQUEST_MAX_ATTEMPTS" 1 3 $Invalid

if ($Configuration["API_URL"] -ne $Configuration["NEXT_PUBLIC_API_URL"]) {
  $Invalid.Add("NEXT_PUBLIC_API_URL (must equal API_URL)")
}
if ($Configuration["APP_URL"] -ne $Configuration["NEXT_PUBLIC_APP_URL"]) {
  $Invalid.Add("NEXT_PUBLIC_APP_URL (must equal APP_URL)")
}

if ($ExpectedProfile -eq "free-beta") {
  Require-Exact $Configuration "MANAGED_POSTAL_ENABLED" "false" $Invalid
  Require-Exact $Configuration "NEXT_PUBLIC_MANAGED_POSTAL_ENABLED" "false" $Invalid
  Require-Exact $Configuration "POSTAL_PROVIDER" "mock" $Invalid
  Require-Exact $Configuration "SERVICE_POSTAL_PRODUCTION_ENABLED" "false" $Invalid
}

Require-Boolean $Configuration "NEXT_PUBLIC_DOCUMENTS_PAGE_ENABLED" $Invalid
Require-Boolean $Configuration "NOTIFICATIONS_REQUIRED" $Invalid

$BindAddress = $Configuration["LYDOC_BIND_ADDRESS"]
if (-not $AllowPublicBind -and $BindAddress -notin @("127.0.0.1", "::1", "localhost")) {
  $Invalid.Add("LYDOC_BIND_ADDRESS (must be loopback unless -AllowPublicBind is explicit)")
}

Validate-DatabaseUrl $Configuration $Invalid

if ($Invalid.Count -gt 0) {
  $Names = ($Invalid | Sort-Object -Unique) -join ", "
  throw "Preflight failed. Invalid or missing settings: $Names"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required for the production preflight."
}

$PreviousApiEnvFile = $env:LYDOC_API_ENV_FILE
try {
  $env:LYDOC_API_ENV_FILE = $EnvironmentPath
  & docker compose --env-file $EnvironmentPath -f $ComposePath config --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose rejected the production configuration."
  }
} finally {
  if ($null -eq $PreviousApiEnvFile) {
    Remove-Item Env:LYDOC_API_ENV_FILE -ErrorAction SilentlyContinue
  } else {
    $env:LYDOC_API_ENV_FILE = $PreviousApiEnvFile
  }
}

$MigrationFiles = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "prisma\migrations") -Recurse -Filter migration.sql -File)
if ($MigrationFiles.Count -eq 0) {
  throw "No Prisma migration is available for a fresh production database."
}

Write-Host "Production preflight passed ($ExpectedProfile, $($MigrationFiles.Count) migrations)." -ForegroundColor Green
