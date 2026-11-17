<#
.SYNOPSIS
    Turn on the Google provider for Supabase Auth and allow localhost redirects.

.DESCRIPTION
    Reads SUPABASE_ACCESS_TOKEN + SUPABASE_URL from your user environment, then
    PATCHes the project's auth config. Copy the redirect URL it prints into
    Google Cloud Console -> APIs & Services -> Credentials -> your OAuth client
    -> "Authorized redirect URIs".

.EXAMPLE
    .\scripts\enable-google-auth.ps1 -ClientId "123-abc.apps.googleusercontent.com" -ClientSecret "GOCSPX-..."
#>
param(
    [Parameter(Mandatory = $true)][string]$ClientId,
    [Parameter(Mandatory = $true)][string]$ClientSecret,
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
    external_google_enabled   = $true
    external_google_client_id = $ClientId
    external_google_secret    = $ClientSecret
    site_url                  = $SiteUrl
    uri_allow_list            = $Redirects
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Method Patch `
    -Uri "https://api.supabase.com/v1/projects/$ref/config/auth" `
    -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } `
    -Body $body -TimeoutSec 60 | Out-Null

Write-Host 'Google provider enabled.'
Write-Host ''
Write-Host 'Add this Authorized redirect URI in Google Cloud Console:' -ForegroundColor Cyan
Write-Host "  $supabaseUrl/auth/v1/callback" -ForegroundColor Yellow
Write-Host ''
Write-Host 'Then restart the Python API so /api/config reports authEnabled: true.'
