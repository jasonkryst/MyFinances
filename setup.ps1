#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "MyFinances -- First-Time Setup"
Write-Host "=============================="
Write-Host ""

# Since 8.0.0 the credentials are variables in .env (POSTGRES_PASSWORD,
# SMTP_PASSWORD), not files in secrets\. Keep .env private: it holds them.
function Test-EnvKey([string]$Key) {
    (Test-Path ".env") -and [bool](Select-String -Path ".env" -Pattern "^$Key=" -Quiet)
}

# -- 1. Generate the database password -----------------------------------------
if (Test-EnvKey "POSTGRES_PASSWORD") {
    Write-Host "-> POSTGRES_PASSWORD already in .env -- skipping generation"
} else {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $password = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    Add-Content -Path ".env" -Value "POSTGRES_PASSWORD=$password"
    Write-Host "-> Generated POSTGRES_PASSWORD in .env"
}

Write-Host ""

# -- 2. Configure SMTP (optional) -----------------------------------------------

# Compose reads a single-quoted .env value literally, so the password can hold
# any character except a single quote.
function Add-SmtpPassword([string]$Password) {
    if ($Password.Contains("'")) {
        Write-Host "  The SMTP password contains a single quote ('), which a .env file can't hold."
        Write-Host "  Set SMTP_PASSWORD yourself (Portainer stack variable or shell environment)."
        return $false
    }
    Add-Content -Path ".env" -Value "SMTP_PASSWORD='$Password'"
    return $true
}

if (Test-EnvKey "SMTP_HOST") {
    Write-Host "-> SMTP settings already in .env -- skipping SMTP setup"
} else {
    Write-Host ""
    $configureSmtp = Read-Host "Configure SMTP for email notifications? [y/N]"
    if ($configureSmtp -match '^[Yy]$') {
        $smtpHost = Read-Host "  SMTP host"
        $smtpPortInput = Read-Host "  SMTP port [587]"
        $smtpPort = if ($smtpPortInput) { $smtpPortInput } else { "587" }
        $smtpSecure = if ($smtpPort -eq "465") { "true" } else { "false" }
        $smtpUser = Read-Host "  SMTP username (blank if none)"
        $smtpFrom = Read-Host "  From address"
        $smtpPasswordSecure = Read-Host "  SMTP password" -AsSecureString
        $smtpPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($smtpPasswordSecure)
        )
        $existingEnv = @()
        if (Test-Path ".env") {
            $existingEnv = Get-Content ".env" | Where-Object { $_ -notmatch '^SMTP_' }
        }
        $existingEnv + @(
            "SMTP_HOST=$smtpHost"
            "SMTP_PORT=$smtpPort"
            "SMTP_USER=$smtpUser"
            "SMTP_FROM=$smtpFrom"
            "SMTP_SECURE=$smtpSecure"
        ) | Set-Content -Path ".env"
        Add-SmtpPassword $smtpPassword | Out-Null
        Write-Host "-> Wrote the SMTP settings to .env"
    } else {
        Add-Content -Path ".env" -Value "SMTP_HOST="
        Write-Host "-> Skipping SMTP setup -- email notifications will stay disabled"
    }
}

Write-Host ""

# -- 3. Start the stack --------------------------------------------------------
Write-Host "Starting containers (this may take a moment on first run)..."
$env:ALLOW_SETUP = 'true'
Write-Host "-> ALLOW_SETUP=true -- /auth/register endpoint is open for first-run setup"
docker compose up -d --build

Write-Host ""
Write-Host "Waiting for server to be healthy..."
$healthy = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $status = docker inspect --format="{{.State.Health.Status}}" myfinances-server 2>$null
        if ($status -eq "healthy") { $healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 3
}

if (-not $healthy) {
    Write-Error "Server did not become healthy. Check logs with: docker compose logs server"
    exit 1
}

# -- 4. Run migrations ---------------------------------------------------------
Write-Host ""
Write-Host "Running database migrations..."
docker compose run --rm server npm run migrate up

# -- 5. Create first user ------------------------------------------------------
Write-Host ""
Write-Host "Create your login account"
Write-Host "-------------------------"
docker compose run --rm server node scripts/create-user.js

Write-Host ""
Write-Host "=============================="
Write-Host "Setup complete!"
Write-Host "Open http://localhost:32900 to access MyFinances."
Write-Host ""
Write-Host "Sign in with the credentials you just created."
Write-Host ""
Write-Host "IMPORTANT: Disable the registration endpoint now that setup is complete:"
Write-Host '  $env:ALLOW_SETUP = ""; docker compose restart server'
Write-Host "This closes /auth/register (it will return 404 for all future requests)."
Write-Host ""