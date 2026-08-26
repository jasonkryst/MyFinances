#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "MyFinances -- First-Time Setup"
Write-Host "=============================="
Write-Host ""

# -- 1. Generate postgres password ---------------------------------------------
if (Test-Path "secrets\postgres_password.txt") {
    Write-Host "-> secrets\postgres_password.txt already exists -- skipping generation"
} else {
    New-Item -ItemType Directory -Force "secrets" | Out-Null
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $password = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    [System.IO.File]::WriteAllText(
        (Resolve-Path "secrets").Path + "\postgres_password.txt",
        $password
    )
    Write-Host "-> Generated secrets\postgres_password.txt"
}

Write-Host ""

# -- 2. Start the stack --------------------------------------------------------
Write-Host "Starting containers (this may take a moment on first run)..."
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

# -- 3. Run migrations ---------------------------------------------------------
Write-Host ""
Write-Host "Running database migrations..."
docker compose exec server npm run migrate up

# -- 4. Create first user ------------------------------------------------------
Write-Host ""
Write-Host "Create your login account"
Write-Host "-------------------------"
docker compose exec -it server node scripts/create-user.js

Write-Host ""
Write-Host "=============================="
Write-Host "Setup complete!"
Write-Host "Open http://localhost:5500 to access MyFinances."
Write-Host ""
Write-Host "In the Settings modal, choose 'PostgreSQL' as your storage backend"
Write-Host "and log in with the credentials you just created."
Write-Host ""