@echo off
setlocal
title JARVIS - publish the site
REM ============================================================
REM   JARVIS - publish the site to Cloudflare (run from cmd)
REM
REM   Double-click this file, or run it from cmd in this folder.
REM   It stamps the build (so the home-screen app asks to update),
REM   writes the Cloudflare config for the worker below, and uploads
REM   the dist folder. Nothing else is touched.
REM
REM   Needs: Node.js (https://nodejs.org) and a Cloudflare API token
REM   with "Edit Cloudflare Workers" permission. The token is asked for
REM   once per window, or set it once with:
REM     setx CLOUDFLARE_API_TOKEN "your-token"   (then open a new window)
REM ============================================================
set "WORKER=jarvis-main-version"
set "COMPAT=2026-01-01"

cd /d "%~dp0"
echo.
echo == JARVIS publish ==
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  goto :fail
)
if not exist "dist\index.html" (
  echo dist\index.html is missing - this file must sit next to the dist folder.
  goto :fail
)

echo [1/3] stamping the build...
node scripts\stamp-version.mjs
if errorlevel 1 (
  echo stamping failed
  goto :fail
)

echo [2/3] writing wrangler.toml...
> wrangler.toml echo name = "%WORKER%"
>> wrangler.toml echo compatibility_date = "%COMPAT%"
>> wrangler.toml echo.
>> wrangler.toml echo [assets]
>> wrangler.toml echo directory = "./dist"

if not defined CLOUDFLARE_API_TOKEN (
  set /p CLOUDFLARE_API_TOKEN=Cloudflare API token (paste, then Enter):
)
if not defined CLOUDFLARE_API_TOKEN (
  echo No token given.
  goto :fail
)

echo [3/3] uploading to Cloudflare...
call npx --yes wrangler@4 deploy
if errorlevel 1 (
  echo.
  echo UPLOAD FAILED. Copy the red lines above and send them to Claude.
  goto :fail
)

echo.
echo DONE. The site is live: https://%WORKER%.daganmatan1998.workers.dev/
echo Open the home-screen app once; it will ask to update if it has an older build.
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
