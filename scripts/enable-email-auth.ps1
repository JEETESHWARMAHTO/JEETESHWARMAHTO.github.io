<#
.SYNOPSIS
    Turn on email + password sign-ins (with auto-confirm) for Supabase Auth.

.DESCRIPTION
    Reads SUPABASE_ACCESS_TOKEN + SUPABASE_URL from your user environment, then
    PATCHes the project's auth config:
      - external_email_enabled / external_password_enabled: email+password on
      - mailer_autoconfirm: new accounts work without an email inbox
      - site_url / uri_allow_list: localhost:3000 allowed (frontend dev server)

    The Python API uses these via /api/auth/signup, /api/auth/login,
    /api/auth/refresh, /api/auth/logout and /api/auth/user.

.EXAMPLE
    .\scripts\enable-email-auth.ps1
#>
param(
    [string]$SiteUrl = 'http://localhost:3000',
    [string]$Redirects = 'http://localhost:3000/**'
)

$ErrorActionPreference = 'Stop'

$token = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
$supabaseUrl = [Environment]::GetEnvironmentVariable('SUPABASE_URL', 'User')

if (-not $token) { throw 'SUPABASE_ACCESS_TOKEN is not set in your user environment.' }
if (-not $supabaseUrl) { throw 'SUPABASE_URL is not set in your user environment.' }

$ref = ([Uri]$supabaseUrl).Host.Split('.')[0]
Write-Host "Project: $ref"

$body = @{
    external_email_enabled    = $true
    external_password_enabled = $true
    mailer_autoconfirm        = $true
    site_url                  = $SiteUrl
    uri_allow_list            = $Redirects
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Method Patch `
    -Uri "https://api.supabase.com/v1/projects/$ref/config/auth" `
    -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } `
    -Body $body -TimeoutSec 60 | Out-Null

Write-Host 'Email + password sign-ins enabled (auto-confirm on).'
Write-Host 'Verify with POST /api/auth/signup and POST /api/auth/login on the API.'
