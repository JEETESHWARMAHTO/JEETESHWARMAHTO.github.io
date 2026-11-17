<#
.SYNOPSIS
    Keeps the Contact Book local stack alive on localhost.

.DESCRIPTION
    Loops forever and restarts anything that stops listening:
      - Python API on 127.0.0.1:8000 (Supabase env injected)
      - Node dev server on localhost:3000
    Run it in the background; it needs no interaction.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\keep-alive.ps1
#>
param(
    [int]$IntervalSeconds = 10,
    [string]$LogPath = "$PSScriptRoot\keep-alive.log"
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot

function Write-Log([string]$Message) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $LogPath -Value $line -Encoding utf8
    Write-Host $line
}

function Test-Port([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Start-Api {
    $env:SUPABASE_URL = [Environment]::GetEnvironmentVariable('SUPABASE_URL', 'User')
    $env:SUPABASE_SERVICE_KEY = [Environment]::GetEnvironmentVariable('SUPABASE_SERVICE_KEY', 'User')
    $env:SUPABASE_ANON_KEY = [Environment]::GetEnvironmentVariable('SUPABASE_ANON_KEY', 'User')
    Start-Process -FilePath 'python' `
        -ArgumentList '-m', 'uvicorn', 'app:app', '--port', '8000', '--host', '127.0.0.1' `
        -WorkingDirectory "$root\backend" `
        -WindowStyle Hidden `
        -RedirectStandardOutput "$root\backend\uvicorn.out.log" `
        -RedirectStandardError "$root\backend\uvicorn.err.log"
    Write-Log 'started python API on 8000'
}

function Start-Web {
    Start-Process -FilePath 'node' `
        -ArgumentList 'server.js' `
        -WorkingDirectory "$root\frontend" `
        -WindowStyle Hidden `
        -RedirectStandardOutput "$root\frontend\server.out.log" `
        -RedirectStandardError "$root\frontend\server.err.log"
    Write-Log 'started node dev server on 3000'
}

Write-Log "keep-alive running (checking every ${IntervalSeconds}s)"

while ($true) {
    if (-not (Test-Port 8000)) { Start-Api }
    if (-not (Test-Port 3000)) { Start-Web }
    Start-Sleep -Seconds $IntervalSeconds
}
