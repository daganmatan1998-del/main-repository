# JARVIS - publish the site to Cloudflare in one go.
#
#   Run from the jarvis-desktop folder:   .\publish.ps1
#
# What it does: stamps the build id (scripts/stamp-version.mjs), then uploads
# the dist folder to the Cloudflare worker named below. Nothing else is touched.
#
# Needs Node.js, and a Cloudflare API token (asked for once per window, or
# saved with:  setx CLOUDFLARE_API_TOKEN "your-token"  then open a new window).
# The token needs "Edit Cloudflare Workers" permission.

# ---- the only things you may need to change ----------------------------------
$WorkerName = "jarvis-main-version"   # the name of the site's worker in Cloudflare
$CompatDate = "2026-01-01"
# ------------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "== JARVIS publish ==" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js is not installed. Get it from https://nodejs.org and run this again." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "dist\index.html")) {
    Write-Host "dist\index.html is missing - run this from the jarvis-desktop folder." -ForegroundColor Red
    exit 1
}

# 1. Stamp the build, so the home-screen app knows there is an update.
Write-Host "[1/3] stamping the build..."
node scripts\stamp-version.mjs
if ($LASTEXITCODE -ne 0) { Write-Host "stamping failed" -ForegroundColor Red; exit 1 }

# 2. The Cloudflare config, written every time so it always matches this file.
Write-Host "[2/3] writing wrangler.toml..."
@"
name = "$WorkerName"
compatibility_date = "$CompatDate"

[assets]
directory = "./dist"
"@ | Set-Content -Path "wrangler.toml" -Encoding ascii

# 3. The token. Asked for only if this window does not have one.
if (-not $env:CLOUDFLARE_API_TOKEN) {
    $secure = Read-Host "Cloudflare API token (paste, then Enter)" -AsSecureString
    $env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

Write-Host "[3/3] uploading to Cloudflare..."
npx --yes wrangler@4 deploy
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "UPLOAD FAILED. Copy the red lines above and send them to Claude." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "DONE. The site is live: https://$WorkerName.daganmatan1998.workers.dev/" -ForegroundColor Green
Write-Host "Open the home-screen app once; it will ask to update if it has an older build."
