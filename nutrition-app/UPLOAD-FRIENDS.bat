@echo off
rem Double-click to upload (or update) the FRIENDS, free app: its own address.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0scripts\upload-app.ps1" -Flavor friends
echo.
echo Press any key to close this window.
pause >nul
