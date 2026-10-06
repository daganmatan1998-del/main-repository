@echo off
title JARVIS - install app
REM ============================================================
REM   JARVIS - put the site on the desktop as an app
REM
REM   Run once. It makes a JARVIS icon on the desktop and in the
REM   Start menu that opens
REM     https://jarvis-main-version.daganmatan1998.workers.dev/
REM   in its own window - no address bar, no tabs - using Chrome
REM   (its voices are part of JARVIS). Edge only if Chrome is missing.
REM
REM   Nothing is copied to the computer but an icon: the window
REM   loads the site every time, so whatever is deployed to
REM   Cloudflare is what opens. Running it again just refreshes
REM   the shortcuts.
REM ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText('%~f0'); iex ($s -split ('#'+'PS'+'#'))[1]"
echo.
pause
exit /b

#PS#
$ErrorActionPreference = 'Stop'
$Url  = 'https://jarvis-main-version.daganmatan1998.workers.dev/'
$Name = 'JARVIS'
$Dir  = Join-Path $env:LOCALAPPDATA 'JARVIS-App'

try {
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null

  # 1. The browser that will run it. Chrome first: JARVIS speaks with Chrome's
  #    voices, and that is the browser he uses. Edge only if Chrome is missing.
  $candidates = @(
    (Join-Path $env:ProgramFiles        'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA        'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles        'Microsoft\Edge\Application\msedge.exe')
  )
  $browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $browser) { throw 'Neither Microsoft Edge nor Google Chrome was found.' }
  Write-Host "  browser : $browser"
  if ($browser -like '*msedge.exe') {
    Write-Host '  WARNING : Chrome is not installed, so this uses Edge. Install Chrome' -ForegroundColor Yellow
    Write-Host '            and run this again to switch JARVIS over to it.' -ForegroundColor Yellow
  }

  # 2. The icon: the site's own icon-192.png, wrapped as a .ico (Windows has
  #    read PNG-inside-ICO since Vista). If the site cannot be reached, the
  #    shortcut keeps the browser's icon rather than failing.
  $ico = Join-Path $Dir 'jarvis.ico'
  $iconLocation = "$browser,0"
  try {
    $png = (New-Object Net.WebClient).DownloadData($Url + 'icon-192.png')
    if ($png.Length -lt 8 -or $png[0] -ne 0x89 -or $png[1] -ne 0x50) { throw 'not a png' }
    $ms = New-Object IO.MemoryStream
    $w  = New-Object IO.BinaryWriter($ms)
    $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)   # ICONDIR: reserved, type=icon, count=1
    $w.Write([Byte]192); $w.Write([Byte]192)                        # width, height
    $w.Write([Byte]0);   $w.Write([Byte]0)                          # palette, reserved
    $w.Write([UInt16]1); $w.Write([UInt16]32)                       # planes, bits per pixel
    $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)             # size, offset of the image
    $w.Write($png); $w.Flush()
    [IO.File]::WriteAllBytes($ico, $ms.ToArray())
    $iconLocation = "$ico,0"
    Write-Host '  icon    : downloaded from the site'
  } catch {
    Write-Host '  icon    : could not download it - using the browser icon for now'
  }

  # 3. The shortcuts. --app opens the page as a window of its own.
  $shell = New-Object -ComObject WScript.Shell
  $places = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
  )
  foreach ($place in $places) {
    $lnk = $shell.CreateShortcut((Join-Path $place "$Name.lnk"))
    $lnk.TargetPath       = $browser
    $lnk.Arguments        = "--app=$Url"
    $lnk.IconLocation     = $iconLocation
    $lnk.Description      = 'JARVIS'
    $lnk.WorkingDirectory = Split-Path $browser
    $lnk.Save()
    Write-Host "  shortcut: $place\$Name.lnk"
  }

  Write-Host ''
  Write-Host '  Done. Double-click JARVIS on the desktop.' -ForegroundColor Cyan
  Write-Host '  (Right-click it in the taskbar -> Pin to taskbar, if you want it there too.)'
} catch {
  Write-Host ''
  Write-Host ("  [X] " + $_.Exception.Message) -ForegroundColor Red
}
