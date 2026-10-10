@echo off
rem  Read & Defend - builds the Android app. Just double-click this file.
rem  Installs whatever is missing (Node.js, Java, Android SDK), builds the game
rem  and leaves ReadAndDefend-debug.apk in this folder.
title Read and Defend - Android build
cd /d "%~dp0"
echo.
echo  Read and Defend - building the Android app.
echo  The first run downloads a few GB and can take 10-20 minutes. Please wait.
echo  If Windows asks for permission to install something, answer Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-android.ps1" %*
set RESULT=%ERRORLEVEL%
echo.
if %RESULT%==0 (
  echo  Finished. The file is ReadAndDefend-debug.apk
) else (
  echo  Something went wrong - see the red message above. You can copy it to me.
)
echo.
pause
exit /b %RESULT%
