@echo off
REM ============================================================
REM   JARVIS - publish the site to Cloudflare
REM
REM   Double-click this file, after unzipping the folder.
REM   Needs Node.js and a Cloudflare API token with the
REM   Edit Cloudflare Workers permission.
REM
REM   No parenthesised blocks anywhere in this file on purpose:
REM   one stray bracket inside a block makes cmd stop with a
REM   syntax error and close the window before it can say why.
REM ============================================================

REM Relaunch inside a window that stays open whatever happens.
if "%~1"=="" start "JARVIS publish" cmd /k "%~f0" go & exit /b

set "WORKER=jarvis-main-version"
set "COMPAT=2026-01-01"
title JARVIS - publish the site

cd /d "%~dp0"
echo.
echo == JARVIS publish ==
echo Folder: %CD%
echo.

REM Running from inside the zip: Windows copies only this one file to a temp folder.
echo %CD% | findstr /i /c:"\AppData\Local\Temp\" >nul
if not errorlevel 1 goto :insidezip

where node >nul 2>&1
if errorlevel 1 goto :nonode

set "SITEDIR="
if exist "dist\index.html" set "SITEDIR=dist"
if not defined SITEDIR if exist "index.html" set "SITEDIR=."
if not defined SITEDIR goto :nosite
echo Site folder: %SITEDIR%
echo.

echo [1/3] Stamping the build...
node scripts\stamp-version.mjs %SITEDIR%
if errorlevel 1 goto :stampfail

echo [2/3] Writing wrangler.toml...
> wrangler.toml echo name = "%WORKER%"
>> wrangler.toml echo compatibility_date = "%COMPAT%"
>> wrangler.toml echo.
>> wrangler.toml echo [assets]
>> wrangler.toml echo directory = "./%SITEDIR%"
if not "%SITEDIR%"=="." goto :skipignore
> .assetsignore echo /UPLOAD.cmd
>> .assetsignore echo /scripts
>> .assetsignore echo /wrangler.toml
>> .assetsignore echo /.assetsignore
>> .assetsignore echo /node_modules
>> .assetsignore echo /.wrangler
>> .assetsignore echo /README.txt
:skipignore

if defined CLOUDFLARE_API_TOKEN goto :havetoken
echo.
echo Paste your Cloudflare API token and press Enter. It is visible while you paste.
set /p CLOUDFLARE_API_TOKEN=Token: 
if not defined CLOUDFLARE_API_TOKEN goto :notoken
:havetoken

echo.
echo [3/3] Uploading to Cloudflare...
echo.
call npx --yes wrangler@4 deploy
if errorlevel 1 goto :deployfail

echo.
echo DONE. The site is live: https://%WORKER%.daganmatan1998.workers.dev/
echo Open the home-screen app once. It asks to update if it has an older build.
goto :end

:insidezip
echo This file is running from inside the zip, so the site files are not next to it.
echo Close this window, right-click the zip, choose Extract All, open the new folder
echo and run UPLOAD.cmd from there.
goto :end

:nonode
echo Node.js is not installed. Get it from https://nodejs.org, install it,
echo then open this file again.
goto :end

:nosite
echo index.html was not found. It must sit next to this file, or in a folder called dist.
echo Make sure you extracted the whole zip.
goto :end

:stampfail
echo.
echo Stamping the build failed. Copy the lines above and send them to Claude.
goto :end

:notoken
echo.
echo No token was entered, so nothing was uploaded.
goto :end

:deployfail
echo.
echo THE UPLOAD FAILED. Copy the lines above and send them to Claude.
goto :end

:end
echo.
echo This window stays open. Close it when you are done.
