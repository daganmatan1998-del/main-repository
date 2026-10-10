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

  You need once: Node.js 18+, and Android Studio (it brings the Android SDK and
  a Java 17 runtime). Everything else is automatic.
#>
param(
  [switch]$Open,
  [switch]$Install,
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Step($m)  { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Fail($m)  { Write-Host ""; Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Run($exe, $argList) {
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { Fail "'$exe $($argList -join ' ')' failed (exit code $LASTEXITCODE)." }
}

# --- Node ------------------------------------------------------------------
Step 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.' }
$nodeMajor = [int]((& node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) { Fail "Node $nodeMajor is too old. Install Node 18 or newer (https://nodejs.org)." }
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
Step 'Looking for Java 17 and the Android SDK'
$studioJbr = @(
  "$env:ProgramFiles\Android\Android Studio\jbr",
  "${env:ProgramFiles(x86)}\Android\Android Studio\jbr",
  "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
) | Where-Object { $_ -and (Test-Path -LiteralPath "$_\bin\java.exe") } | Select-Object -First 1

if ($studioJbr) {
  $env:JAVA_HOME = $studioJbr
} elseif (-not ($env:JAVA_HOME -and (Test-Path -LiteralPath "$env:JAVA_HOME\bin\java.exe"))) {
  Fail "Java was not found. Install Android Studio (https://developer.android.com/studio) - it includes Java 17 - then run this again. Or run with -Open."
}
Write-Host "JAVA_HOME = $env:JAVA_HOME"

$sdk = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk") |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $sdk) {
  Fail "The Android SDK was not found. Open Android Studio once and let it finish its first-run setup (it installs the SDK), then run this again."
}
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
