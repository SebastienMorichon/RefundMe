param(
  [switch] $CheckOnly
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

function Write-Step {
  param([string] $Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Info {
  param([string] $Message)
  Write-Host "    $Message" -ForegroundColor DarkGray
}

function Add-PathIfExists {
  param([string] $PathToAdd)
  if (Test-Path $PathToAdd) {
    $env:PATH = "$PathToAdd;$env:PATH"
  }
}

function Set-DefaultEnv {
  param(
    [string] $Name,
    [string] $Value
  )
  if (-not [Environment]::GetEnvironmentVariable($Name, "Process")) {
    Set-Item -Path "env:$Name" -Value $Value
  }
}

function Import-DotEnv {
  param([string] $Path)
  if (-not (Test-Path $Path)) {
    return
  }

  Get-Content $Path | ForEach-Object {
    $Line = $_.Trim()
    if (-not $Line -or $Line.StartsWith("#")) {
      return
    }

    $SeparatorIndex = $Line.IndexOf("=")
    if ($SeparatorIndex -lt 1) {
      return
    }

    $Name = $Line.Substring(0, $SeparatorIndex).Trim()
    $Value = $Line.Substring($SeparatorIndex + 1).Trim()
    if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
      $Value = $Value.Substring(1, $Value.Length - 2)
    }

    Set-Item -Path "env:$Name" -Value $Value
  }
}

Write-Step "Preparation de l'environnement Lydoc"

$RuntimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
Add-PathIfExists (Join-Path $RuntimeRoot "node\bin")
Add-PathIfExists (Join-Path $RuntimeRoot "bin\fallback")
Add-PathIfExists (Join-Path $RuntimeRoot "bin\override")
Add-PathIfExists (Join-Path $RuntimeRoot "native\poppler\Library\bin")
Add-PathIfExists "C:\Program Files\Tesseract-OCR"

$LocalTesseractData = Join-Path $ProjectRoot "tools\tesseract-data"
if (Test-Path (Join-Path $LocalTesseractData "fra.traineddata")) {
  Set-DefaultEnv "TESSDATA_PREFIX" $LocalTesseractData
}

$EnvLocalPath = Join-Path $ProjectRoot ".env.local"
if (-not (Test-Path $EnvLocalPath)) {
  @"
# Configuration locale Lydoc.
# Tu peux modifier les valeurs API ici sans les partager avec Git.

DATABASE_URL=postgresql://lydoc:lydoc@localhost:5432/lydoc
APP_URL=http://localhost:3000
API_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
TRUST_PROXY=false
SESSION_SECRET=local-dev-session-secret-change-me-please
DOCUMENT_ENCRYPTION_SECRET=local-dev-document-secret-change-me-please

STRIPE_SECRET_KEY=sk_test_change_me
STRIPE_WEBHOOK_SECRET=whsec_change_me
MISTRAL_API_KEY=
POSTAL_PROVIDER=mock
SERVICE_POSTAL_API_KEY=
SERVICE_POSTAL_ENV=sandbox
SERVICE_POSTAL_DEFAULT_PRODUCT=vertesuivi
SERVICE_POSTAL_PRODUCTION_ENABLED=false
SERVICE_POSTAL_WEBHOOK_SECRET=
RESEND_API_KEY=re_change_me
RESEND_FROM_EMAIL=
DOCUMENT_RETENTION_DAYS=365
DOCUMENT_DELETION_GRACE_DAYS=7
DOCUMENT_MIGRATION_BACKUP_DAYS=7
"@ | Set-Content -Path $EnvLocalPath -Encoding UTF8
  Write-Info "Fichier .env.local cree. Tu peux y mettre tes cles API."
}

Import-DotEnv $EnvLocalPath

Set-DefaultEnv "DATABASE_URL" "postgresql://lydoc:lydoc@localhost:5432/lydoc"
Set-DefaultEnv "APP_URL" "http://localhost:3000"
Set-DefaultEnv "API_URL" "http://localhost:3001"
Set-DefaultEnv "NEXT_PUBLIC_API_URL" "http://localhost:3001"
Set-DefaultEnv "TRUST_PROXY" "false"
Set-DefaultEnv "SESSION_SECRET" "local-dev-session-secret-change-me-please"
Set-DefaultEnv "DOCUMENT_ENCRYPTION_SECRET" "local-dev-document-secret-change-me-please"
Set-DefaultEnv "POSTAL_PROVIDER" "mock"
Set-DefaultEnv "SERVICE_POSTAL_ENV" "sandbox"
Set-DefaultEnv "SERVICE_POSTAL_DEFAULT_PRODUCT" "vertesuivi"
Set-DefaultEnv "SERVICE_POSTAL_PRODUCTION_ENABLED" "false"
Set-DefaultEnv "DOCUMENT_RETENTION_DAYS" "365"
Set-DefaultEnv "DOCUMENT_DELETION_GRACE_DAYS" "7"
Set-DefaultEnv "DOCUMENT_MIGRATION_BACKUP_DAYS" "7"

if ($env:STRIPE_SECRET_KEY -eq "sk_test_change_me") {
  Write-Host "    STRIPE_SECRET_KEY utilise encore la valeur de test placeholder. Le paiement sera indisponible." -ForegroundColor Yellow
}

if ($env:MISTRAL_API_KEY -eq "") {
  Write-Host "    MISTRAL_API_KEY est vide. L'OCR Mistral sera indisponible tant que la cle n'est pas renseignee." -ForegroundColor Yellow
}

Write-Step "Verification des outils"

$PnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $PnpmCommand) {
  throw "pnpm est introuvable. Verifie que le runtime Codex existe dans $RuntimeRoot."
}
Write-Info "pnpm: $(pnpm --version)"

$PdfToPpmCommand = Get-Command pdftoppm -ErrorAction SilentlyContinue
$TesseractCommand = Get-Command tesseract -ErrorAction SilentlyContinue
if (-not $PdfToPpmCommand) {
  throw "pdftoppm est introuvable. Le controle local de confidentialite ne peut pas demarrer."
}
if (-not $TesseractCommand) {
  throw "Tesseract OCR est introuvable. Installe UB-Mannheim.TesseractOCR avant de demarrer Lydoc."
}
$TesseractLanguages = (& tesseract --list-langs 2>$null) -join "`n"
if ($TesseractLanguages -notmatch "(?m)^fra$" -or $TesseractLanguages -notmatch "(?m)^eng$") {
  throw "Tesseract doit disposer des langues fra et eng pour le controle local de confidentialite."
}
Write-Info "pdftoppm: $($PdfToPpmCommand.Source)"
Write-Info "tesseract: $($TesseractCommand.Source) (fra+eng)"

if ($CheckOnly) {
  Write-Host ""
  Write-Host "Controle termine: le lanceur est pret." -ForegroundColor Green
  exit 0
}

$DockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if ($DockerCommand) {
  Write-Step "Demarrage de PostgreSQL et MinIO avec Docker"
  docker compose up -d
} else {
  Write-Host "    Docker est introuvable. Je continue, mais PostgreSQL doit deja tourner sur localhost:5432." -ForegroundColor Yellow
}

if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  Write-Step "Installation des dependances"
  pnpm install
}

Write-Step "Arret des anciennes instances Lydoc"
node scripts/kill-dev-ports.mjs

Write-Step "Synchronisation de la base de donnees"
pnpm db:push

Write-Step "Demarrage de Lydoc"
Write-Host "    Web: http://localhost:3000" -ForegroundColor Green
Write-Host "    API: http://localhost:3001/health" -ForegroundColor Green
Write-Host ""
Write-Host "Garde cette fenetre ouverte. Ferme-la avec Ctrl+C pour arreter Lydoc." -ForegroundColor DarkGray
Write-Host ""

Remove-Item Env:PORT -ErrorAction SilentlyContinue
pnpm dev
