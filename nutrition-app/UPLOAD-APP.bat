@echo off
rem Double-click to upload the app (first time) or update it (any time after).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0scripts\upload-app.ps1"
echo.
echo Press any key to close this window.
pause >nul
