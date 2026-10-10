<#
  Read & Defend - build the Android app on Windows.

  Run from PowerShell, in this folder:
      powershell -ExecutionPolicy Bypass -File .\build-android.ps1

  Switches:
      -Open      open the project in Android Studio instead of building an APK
      -Install   after building, install the APK on a phone connected by USB (adb)
      -Clean     delete the generated android\ folder first and start over

  What it does: npm install -> build the game -> create the Android project
  (first run) -> add the microphone permission -> copy the game into it ->
  build a debug APK with Gradle -> ReadAndDefend-debug.apk next to this script.

  Nothing needs to be installed beforehand: whatever is missing (Node.js, Java 17,
  the Android SDK) is downloaded and installed by this script. Easiest way to
  run it: double-click Build-Android.bat. Windows may ask once for permission
  to install Node.js / Java - answer Yes.
#>
param(
  [switch]$Open,
  [switch]$Install,
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location -LiteralPath $PSScriptRoot

function Step($m)  { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Fail($m)  { Write-Host ""; Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Run($exe, $argList) {
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { Fail "'$exe $($argList -join ' ')' failed (exit code $LASTEXITCODE)." }
}

# --- Helpers -----------------------------------------------------------------
function Refresh-Path {
  # Programs installed a moment ago are not on this window's PATH yet.
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($m, $u) | Where-Object { $_ }) -join ';'
}

function Winget-Install($id, $what) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "$what is missing and 'winget' (Windows Package Manager) is not available to install it. Install $what by hand, then run this again."
  }
  Write-Host "Installing $what (Windows may ask for permission - answer Yes)..."
  & winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
}

function Java-Major($home_) {
  $rel = Join-Path $home_ 'release'
  if (Test-Path -LiteralPath $rel) {
    $m = Select-String -LiteralPath $rel -Pattern 'JAVA_VERSION="(\d+)' | Select-Object -First 1
    if ($m) { return [int]$m.Matches[0].Groups[1].Value }
  }
  return 17
}

function Find-Java {
  $cands = New-Object System.Collections.ArrayList
  foreach ($d in @("$env:ProgramFiles\Android\Android Studio\jbr", "${env:ProgramFiles(x86)}\Android\Android Studio\jbr", "$env:LOCALAPPDATA\Programs\Android Studio\jbr", $env:JAVA_HOME)) { if ($d) { [void]$cands.Add($d) } }
  foreach ($parent in @("$env:ProgramFiles\Microsoft", "$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java", "$env:ProgramFiles\Zulu")) {
    if (Test-Path -LiteralPath $parent) {
      Get-ChildItem -LiteralPath $parent -Directory -Filter '*jdk*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object { [void]$cands.Add($_.FullName) }
    }
  }
  foreach ($c in $cands) {
    if ((Test-Path -LiteralPath "$c\bin\java.exe") -and (Java-Major $c) -ge 17) { return $c }
  }
  return $null
}

function Find-Sdk {
  return @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk") |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

# --- Node ------------------------------------------------------------------
Step 'Checking Node.js'
$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) { $nodeOk = ([int]((& node -v).TrimStart('v').Split('.')[0]) -ge 18) }
if (-not $nodeOk) {
  Winget-Install 'OpenJS.NodeJS.LTS' 'Node.js'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js was installed but is not visible yet. Close this window, open it again and run the script once more.' }
}
Write-Host "Node $(& node -v)"

# --- Game build ------------------------------------------------------------
Step 'Installing packages'
Run 'npm' @('install', '--no-audit', '--no-fund')

Step 'Building the game'
Run 'npm' @('run', 'build')

# --- Android project -------------------------------------------------------
if ($Clean -and (Test-Path -LiteralPath 'android')) {
  Step 'Removing the old android folder'
  Remove-Item -LiteralPath 'android' -Recurse -Force
}

if (-not (Test-Path -LiteralPath 'android')) {
  Step 'Creating the Android project (first run only)'
  Run 'npx' @('cap', 'add', 'android')
  if (Test-Path -LiteralPath 'assets\icon-only.png') {
    Step 'Generating the app icon'
    & npx --yes '@capacitor/assets@3.0.5' generate --android --iconBackgroundColor '#000000'
    if ($LASTEXITCODE -ne 0) { Write-Host 'Icon generation failed - continuing with the default icon.' -ForegroundColor Yellow }
  }
}

Step 'Adding the microphone permission'
Run 'node' @('scripts/patch-android.mjs', $PSScriptRoot)

Step 'Copying the game into the Android project'
Run 'npx' @('cap', 'sync', 'android')

if ($Open) {
  Step 'Opening Android Studio'
  Run 'npx' @('cap', 'open', 'android')
  Write-Host 'In Android Studio: press the green Run button to start it on a phone or emulator.'
  exit 0
}

# --- Java and the Android SDK ---------------------------------------------
Step 'Checking Java 17+'
$javaHome = Find-Java
if (-not $javaHome) {
  Winget-Install 'Microsoft.OpenJDK.17' 'Java 17'
  $javaHome = Find-Java
  if (-not $javaHome) { Fail 'Java 17 was installed but could not be found. Close this window, open it again and run the script once more.' }
}
$env:JAVA_HOME = $javaHome
Write-Host "JAVA_HOME = $env:JAVA_HOME"

Step 'Checking the Android SDK'
$sdk = Find-Sdk
$sdkRoot = if ($sdk) { $sdk } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$sdkmanager = Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
$needPackages = -not (Test-Path -LiteralPath (Join-Path $sdkRoot 'platforms\android-34')) -or
                -not (Test-Path -LiteralPath (Join-Path $sdkRoot 'build-tools\34.0.0'))

if ($needPackages) {
  if (-not (Test-Path -LiteralPath $sdkmanager)) {
    # Android Studio is not required: Google's command-line tools are enough.
    $existing = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'cmdline-tools') -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path -LiteralPath "$($_.FullName)\bin\sdkmanager.bat" } | Select-Object -First 1
    if ($existing) {
      $sdkmanager = "$($existing.FullName)\bin\sdkmanager.bat"
    } else {
      Write-Host 'Downloading the Android command-line tools (about 150 MB)...'
      $ProgressPreference = 'SilentlyContinue'
      $build = '11076708'
      try {
        $page = (Invoke-WebRequest -UseBasicParsing 'https://developer.android.com/studio').Content
        if ($page -match 'commandlinetools-win-(\d+)_latest\.zip') { $build = $Matches[1] }
      } catch { }
      $zip = Join-Path $env:TEMP 'android-cmdline-tools.zip'
      Invoke-WebRequest -UseBasicParsing "https://dl.google.com/android/repository/commandlinetools-win-${build}_latest.zip" -OutFile $zip
      $tmp = Join-Path $env:TEMP 'android-cmdline-tools'
      if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
      Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
      $dest = Join-Path $sdkRoot 'cmdline-tools\latest'
      New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
      if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
      Move-Item -LiteralPath (Join-Path $tmp 'cmdline-tools') -Destination $dest
      Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
      $sdkmanager = Join-Path $dest 'bin\sdkmanager.bat'
    }
  }
  Step 'Installing the Android SDK pieces (a few minutes, runs once)'
  # Accept the Android licenses (they are shown on screen; this answers "y").
  (1..80 | ForEach-Object { 'y' }) | & $sdkmanager "--sdk_root=$sdkRoot" --licenses | Out-Null
  & $sdkmanager "--sdk_root=$sdkRoot" 'platform-tools' 'platforms;android-34' 'build-tools;34.0.0'
  if ($LASTEXITCODE -ne 0) { Fail 'Installing the Android SDK pieces failed. Check the internet connection and run this again.' }
}
$sdk = $sdkRoot
Write-Host "Android SDK = $sdk"

# Gradle reads the SDK location from local.properties. Written as UTF-8 WITHOUT
# a BOM (Windows PowerShell 5.1's Set-Content adds one).
$props = 'sdk.dir=' + ($sdk -replace '\\', '\\') + "`n"
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'android\local.properties'), $props, (New-Object System.Text.UTF8Encoding($false)))

# --- Build the APK -----------------------------------------------------------
Step 'Building the APK (the first build downloads Gradle and takes a few minutes)'
Push-Location -LiteralPath 'android'
try {
  Run '.\gradlew.bat' @('assembleDebug', '--console=plain')
} finally {
  Pop-Location
}

$apk = 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { Fail "Build finished but $apk was not found." }
Copy-Item -LiteralPath $apk -Destination 'ReadAndDefend-debug.apk' -Force
Write-Host ""
Write-Host "Done: $(Join-Path $PSScriptRoot 'ReadAndDefend-debug.apk')" -ForegroundColor Green
if (-not $Install) { Start-Process explorer.exe -ArgumentList "/select,`"$(Join-Path $PSScriptRoot 'ReadAndDefend-debug.apk')`"" }

if ($Install) {
  Step 'Installing on the connected phone'
  $adb = Join-Path $sdk 'platform-tools\adb.exe'
  if (-not (Test-Path -LiteralPath $adb)) { Fail 'adb was not found in the SDK (install "Android SDK Platform-Tools" in Android Studio).' }
  Run $adb @('install', '-r', 'ReadAndDefend-debug.apk')
  Write-Host 'Installed. Open "Read & Defend" on the phone.' -ForegroundColor Green
} else {
  Write-Host 'To put it on a phone: copy ReadAndDefend-debug.apk to the phone and open it (allow "install unknown apps"),'
  Write-Host 'or connect the phone with USB debugging on and run again with -Install.'
}
