#Requires -Version 5.1
# Restore the Postgres data volume from a backup.ps1 dump. DESTRUCTIVE: drops
# and recreates every object in the target database before loading the dump.
param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path $Path)) {
    Write-Error "$Path not found"
    exit 1
}

Write-Host "This will REPLACE all data in the myfinances-postgres database with the"
Write-Host "contents of $Path."
$confirm = Read-Host "Type 'yes' to continue"
if ($confirm -ne "yes") {
    Write-Host "Aborted."
    exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$containerTmp = "/tmp/myfinances-restore-$timestamp.dump"
docker compose cp $Path "postgres:${containerTmp}"

Write-Host "Restoring $Path -> myfinances-postgres"
docker compose exec -T postgres pg_restore -U myfinances -d myfinances --clean --if-exists $containerTmp
docker compose exec -T postgres rm -f $containerTmp

Write-Host "Done. Restart the server so it reconnects with a clean connection pool:"
Write-Host "  docker compose restart server"
