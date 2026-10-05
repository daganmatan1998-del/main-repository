@echo off
setlocal
title WS-01 - build the desktop app
color 0C
cd /d "%~dp0"

REM ============================================================
REM   WS-01 - BUILD AND INSTALL THE DESKTOP APP
REM
REM   Double-click this file. It builds the app from this folder,
REM   puts WS-01.exe in %LOCALAPPDATA%\WS-01, adds a shortcut on
REM   the desktop and in the Start menu, and opens it.
REM   Needs what JARVIS already needs: Node.js, Rust, MSVC tools.
REM ============================================================

echo.
echo  ============================================
echo    WS-01  -  desktop app
echo  ============================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo  [X] Node.js is missing. Install it from https://nodejs.org and run this again.
  goto :fail
)
where cargo >nul 2>&1
if errorlevel 1 (
  echo  [X] Rust is missing. Install it from https://rustup.rs and run this again.
  goto :fail
)

if not exist "node_modules" (
  echo  [1/4] installing the build tools - first time only, a minute or two...
  call npm install
  if errorlevel 1 (
    echo  [X] npm install failed. Copy the lines above to Claude.
    goto :fail
  )
) else (
  echo  [1/4] build tools already installed.
)

echo  [2/4] building. The first build takes 10-25 minutes, later ones a minute or two.
echo        Lines that say "Compiling ..." are what should be happening.
echo.
call npm run tauri build
if errorlevel 1 (
  echo.
  echo  [X] the build failed. Copy the last 20 lines to Claude.
  goto :fail
)

set "EXE=%~dp0src-tauri\target\release\ws01.exe"
if not exist "%EXE%" (
  echo  [X] the build finished but ws01.exe is not there.
  goto :fail
)

echo.
echo  [3/4] installing into %LOCALAPPDATA%\WS-01 ...
taskkill /IM WS-01.exe /F >nul 2>&1
if not exist "%LOCALAPPDATA%\WS-01" mkdir "%LOCALAPPDATA%\WS-01"
copy /Y "%EXE%" "%LOCALAPPDATA%\WS-01\WS-01.exe" >nul
if errorlevel 1 (
  echo  [X] could not copy WS-01.exe - is it still open? Close it and run this again.
  goto :fail
)

echo  [4/4] shortcuts on the desktop and in the Start menu...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = New-Object -ComObject WScript.Shell; $exe = Join-Path $env:LOCALAPPDATA 'WS-01\WS-01.exe'; foreach ($d in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) { $l = $s.CreateShortcut((Join-Path $d 'WS-01.lnk')); $l.TargetPath = $exe; $l.WorkingDirectory = (Split-Path $exe); $l.Description = 'WS-01 web shooter'; $l.Save() }"

echo.
echo  Done. WS-01 is on your desktop and in the Start menu.
echo  An installer was also made, if you want one to share:
echo    %~dp0src-tauri\target\release\bundle\nsis\
echo.
start "" "%LOCALAPPDATA%\WS-01\WS-01.exe"
pause
exit /b 0

:fail
echo.
pause
exit /b 1
