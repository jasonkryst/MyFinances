#Requires -Version 5.1
# Back up the Postgres data volume used by the optional self-hosted backend.
# Writes a pg_dump custom-format archive (restorable with restore.ps1) to
# BackupDir (default .\backups). Safe to run against a live stack -- pg_dump
# takes a consistent snapshot without blocking normal reads/writes.
#
# Dumps to a temp path inside the postgres container first, then copies it
# out with `docker compose cp` -- piping pg_dump's binary output straight
# through a shell redirect is not reliably byte-safe on every platform
# (notably PowerShell), so both backup.ps1 and backup.sh use this same
# two-step approach.
param(
    [string]$BackupDir = "backups"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file = Join-Path $BackupDir "myfinances-$timestamp.dump"
$containerTmp = "/tmp/myfinances-backup-$timestamp.dump"

New-Item -ItemType Directory -Force $BackupDir | Out-Null

Write-Host "Backing up myfinances-postgres -> $file"
docker compose exec -T postgres pg_dump -U myfinances -d myfinances -Fc -f $containerTmp
docker compose cp "postgres:${containerTmp}" $file
docker compose exec -T postgres rm -f $containerTmp

$size = "{0:N1} MB" -f ((Get-Item $file).Length / 1MB)
Write-Host "Done ($size). Restore with: .\restore.ps1 `"$file`""
