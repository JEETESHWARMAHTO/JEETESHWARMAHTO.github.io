<#
.SYNOPSIS
    Smoke-test every page and API route of the Contact Book locally.

.EXAMPLE
    .\scripts\check-pages.ps1
#>
param(
    [string]$Base = 'http://localhost:3000'
)

$ErrorActionPreference = 'Continue'
$fail = 0

function Check-Page {
    param([string]$Path, [string]$MustContain)

    try {
        $res = Invoke-WebRequest -Uri "$Base$Path" -TimeoutSec 20 -UseBasicParsing
    } catch {
        Write-Host ("FAIL {0,-12} {1}" -f $Path, $_.Exception.Message) -ForegroundColor Red
        $script:fail++
        return
    }

    $body = $res.Content
    $status = $res.StatusCode
    $leak = $body -match '\{\{[^}]*\}\}'

    if ($status -ne 200) {
        Write-Host ("FAIL {0,-12} status {1}" -f $Path, $status) -ForegroundColor Red
        $script:fail++
    } elseif ($leak) {
        $token = [regex]::Match($body, '\{\{[^}]*\}\}').Value
        Write-Host ("FAIL {0,-12} unresolved token {1}" -f $Path, $token) -ForegroundColor Red
        $script:fail++
    } elseif ($MustContain -and $body -notmatch $MustContain) {
        Write-Host ("FAIL {0,-12} missing marker {1}" -f $Path, $MustContain) -ForegroundColor Red
        $script:fail++
    } else {
        Write-Host ("ok   {0,-12} {1} KB" -f $Path, [math]::Round($body.Length / 1kb, 1)) -ForegroundColor Green
    }
}

Check-Page '/' 'contact-grid'
Check-Page '/favorites' 'panel-favorites|Favorites'
Check-Page '/groups' 'panel-groups|Groups'
Check-Page '/settings' 'storage-value'

try {
    $health = Invoke-RestMethod -Uri "$Base/api/health" -TimeoutSec 20
    Write-Host ("ok   /api/health   {0}, {1} contacts" -f $health.storage, $health.contacts) -ForegroundColor Green
} catch {
    Write-Host ("FAIL /api/health   {0}" -f $_.Exception.Message) -ForegroundColor Red
    $fail++
}

try {
    $config = Invoke-RestMethod -Uri "$Base/api/config" -TimeoutSec 20
    $auth = if ($config.authEnabled) { 'google auth ready' } else { 'google provider not configured' }
    Write-Host ("ok   /api/config   {0}" -f $auth) -ForegroundColor Green
} catch {
    Write-Host ("FAIL /api/config   {0}" -f $_.Exception.Message) -ForegroundColor Red
    $fail++
}

Write-Host ''
if ($fail -eq 0) {
    Write-Host 'All checks passed.' -ForegroundColor Green
} else {
    Write-Host "$fail check(s) failed." -ForegroundColor Red
    exit 1
}
