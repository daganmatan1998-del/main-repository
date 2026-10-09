# One-click upload for Windows: installs, signs in to Cloudflare, deploys,
# stores the Claude key as a server secret, and hands back the app link.
# Started by UPLOAD-APP.bat (double-click). Safe to run again to update the app.
#
# Talks to the user through Hebrew dialog windows; the console only shows
# progress. Saved as UTF-8 with BOM so Windows PowerShell 5.1 reads the Hebrew.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:WRANGLER_SEND_METRICS = 'false'
$Title = 'נוטרי — העלאת האפליקציה'

# ---------------- dialogs ----------------

function Show-Message([string]$Text, [string]$Icon = 'Information', [string]$Buttons = 'OK') {
  $opts = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor [System.Windows.Forms.MessageBoxOptions]::RightAlign
  return [System.Windows.Forms.MessageBox]::Show($Text, $Title,
    [System.Windows.Forms.MessageBoxButtons]::$Buttons,
    [System.Windows.Forms.MessageBoxIcon]::$Icon,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $opts)
}

# Right-to-left input window. Returns the text, or $null when cancelled.
function Ask-Text([string]$Prompt, [string]$OkText = 'אישור', [string]$CancelText = 'ביטול') {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $Title
  $form.RightToLeft = 'Yes'
  $form.RightToLeftLayout = $true
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.TopMost = $true
  $form.ClientSize = New-Object System.Drawing.Size(520, 230)
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Prompt
  $label.Location = New-Object System.Drawing.Point(16, 14)
  $label.Size = New-Object System.Drawing.Size(488, 120)
  $form.Controls.Add($label)

  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point(16, 140)
  $box.Size = New-Object System.Drawing.Size(488, 28)
  $box.RightToLeft = 'No'
  $form.Controls.Add($box)

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = $OkText
  $ok.Location = New-Object System.Drawing.Point(16, 184)
  $ok.Size = New-Object System.Drawing.Size(160, 34)
  $ok.DialogResult = 'OK'
  $form.Controls.Add($ok)
  $form.AcceptButton = $ok

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = $CancelText
  $cancel.Location = New-Object System.Drawing.Point(186, 184)
  $cancel.Size = New-Object System.Drawing.Size(160, 34)
  $cancel.DialogResult = 'Cancel'
  $form.Controls.Add($cancel)
  $form.CancelButton = $cancel

  $form.Add_Shown({ $form.Activate(); $box.Focus() })
  $result = $form.ShowDialog()
  $text = $box.Text.Trim()
  $form.Dispose()
  if ($result -ne 'OK') { return $null }
  return $text
}

function Step([string]$Text) {
  Write-Host ''
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Fail([string]$Text) {
  Show-Message $Text 'Error' | Out-Null
  exit 1
}

# Runs a command, shows its output live, and returns it as one string.
# The command is not attached to a terminal, so wrangler never waits for typed answers.
function Run([string]$Exe, [string[]]$CmdArgs, $InputText = $null) {
  $captured = @()
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($null -ne $InputText) {
      $InputText | & $Exe @CmdArgs 2>&1 | ForEach-Object { "$_" } | Tee-Object -Variable captured | Out-Host
    } else {
      & $Exe @CmdArgs 2>&1 | ForEach-Object { "$_" } | Tee-Object -Variable captured | Out-Host
    }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  # Strip colour codes ([char]27 — Windows PowerShell 5.1 has no `e escape).
  $text = (($captured | Out-String) -replace ([string][char]27 + '\[[0-9;]*[A-Za-z]'), '')
  return [pscustomobject]@{ Code = $code; Text = $text }
}

# ---------------- 0. welcome ----------------

$welcome = @"
שלום! הקובץ הזה יעלה את האפליקציה לאינטרנט כדי שתוכל להתקין אותה בטלפון.

מה יקרה עכשיו (בערך 5 דקות):
1. התקנת רכיבים — אוטומטי.
2. התחברות ל-Cloudflare (חינם) — ייפתח דפדפן, נרשמים/נכנסים ולוחצים Allow.
3. העלאה — אוטומטי.
4. הדבקת מפתח ה-Claude (בשביל עוזר התזונה) — אפשר גם לדלג.
5. תקבל קישור לפתוח בטלפון.

לא לסגור את החלון השחור עד הסוף. להתחיל?
"@
if ((Show-Message $welcome 'Information' 'OKCancel') -ne 'OK') { exit 0 }

# ---------------- 1. Node.js ----------------

Step 'Checking Node.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Start-Process 'https://nodejs.org'
  Fail "לא מצאתי את Node.js במחשב.`n`nנפתח לך האתר nodejs.org — הורד את הגרסה LTS, התקן, ואז לחץ שוב פעמיים על UPLOAD-APP."
}
if (-not (Test-Path (Join-Path $Root 'package.json'))) {
  Fail "הקובץ UPLOAD-APP צריך להיות בתוך תיקיית nutrition-app (ליד הקובץ package.json).`n`nחלץ את כל קובץ ה-zip ונסה שוב."
}

# ---------------- 2. install ----------------

Step 'Installing components (about a minute)'
$r = Run 'npm.cmd' @('install', '--no-audit', '--no-fund')
if ($r.Code -ne 0) {
  Fail "ההתקנה נכשלה. בדוק שיש אינטרנט ונסה שוב.`n`nאם זה חוזר — צלם את החלון השחור ושלח לי."
}

# ---------------- 3. Cloudflare sign-in ----------------

Step 'Checking Cloudflare sign-in'
$who = Run 'npx.cmd' @('wrangler', 'whoami')
if ($who.Text -match 'not authenticated' -or $who.Code -ne 0) {
  $msg = @"
עכשיו ייפתח דפדפן של Cloudflare.

• אין לך חשבון? לחץ Sign up והירשם (חינם), אשר את המייל וחזור לדף.
• יש לך חשבון? פשוט התחבר.
• בסוף לחץ על הכפתור הכחול Allow.

אחרי שמופיע "You have granted authorization" — חזור לכאן. הכל ימשיך לבד.
"@
  Show-Message $msg | Out-Null
  Step 'Opening the Cloudflare sign-in page in your browser'
  # Not captured: login only needs the browser round-trip.
  & npx.cmd wrangler login
  $who = Run 'npx.cmd' @('wrangler', 'whoami')
  if ($who.Text -match 'not authenticated' -or $who.Code -ne 0) {
    Fail "ההתחברות ל-Cloudflare לא הושלמה.`n`nלחץ שוב פעמיים על UPLOAD-APP ונסה שוב — והפעם לחץ Allow בדפדפן."
  }
}

# ---------------- 4. deploy ----------------

$url = $null
for ($attempt = 1; $attempt -le 3 -and -not $url; $attempt++) {
  Step "Uploading the app (attempt $attempt)"
  $d = Run 'npx.cmd' @('wrangler', 'deploy')
  $m = [regex]::Match($d.Text, 'https://[A-Za-z0-9.-]+\.workers\.dev')
  if ($d.Code -eq 0 -and $m.Success) { $url = $m.Value; break }

  $onboarding = [regex]::Match($d.Text, 'https://dash\.cloudflare\.com/[^\s]+/workers/onboarding')
  if ($onboarding.Success) {
    # Brand-new Cloudflare accounts must pick a workers.dev name once.
    Start-Process $onboarding.Value
    $msg = @"
פעם ראשונה ב-Cloudflare: צריך לבחור שם לכתובת שלך.

בדפדפן שנפתח:
1. הקלד שם באנגלית (למשל dana-nutri) ולחץ Set up / Continue.
2. אם מבקשים לבחור תוכנית — בחר Free.

כשסיימת, לחץ כאן OK ונמשיך.
"@
    if ((Show-Message $msg 'Information' 'OKCancel') -ne 'OK') { exit 0 }
    continue
  }
  if ($d.Text -match 'More than one account') {
    Fail "לחשבון ה-Cloudflare שלך יש כמה חשבונות-משנה, ואני לא יודע לאיזה להעלות.`n`nשלח לי צילום של החלון השחור ואסביר מה לעשות."
  }
  $retry = Show-Message "ההעלאה לא הצליחה (ניסיון $attempt מתוך 3).`n`nבדוק שיש אינטרנט ולחץ 'נסה שוב'. אם זה ממשיך — צלם את החלון השחור ושלח לי." 'Warning' 'RetryCancel'
  if ($retry -ne 'Retry') { exit 1 }
}
if (-not $url) { Fail "ההעלאה לא הצליחה. צלם את החלון השחור ושלח לי." }

# ---------------- 5. Claude key ----------------

Step 'Checking the assistant key'
$secrets = Run 'npx.cmd' @('wrangler', 'secret', 'list')
$hasKey = $secrets.Text -match 'ANTHROPIC_API_KEY'
$askKey = $true
if ($hasKey) {
  $ans = Show-Message "מפתח ה-Claude כבר מוגדר בשרת מהפעם הקודמת.`n`nלהחליף אותו במפתח חדש?" 'Question' 'YesNo'
  $askKey = ($ans -eq 'Yes')
}
while ($askKey) {
  $prompt = @"
הדבק כאן את מפתח ה-Claude (מתחיל ב-sk-ant-).
להדבקה: לחץ בתיבה ואז Ctrl+V.

אין לך מפתח עדיין? לחץ "פתח את האתר", היכנס ל-API Keys ולחץ Create Key.
(רק לעוזר התזונה. כל השאר עובד גם בלי.)
"@
  $key = Ask-Text $prompt 'שמירת המפתח' 'פתח את האתר / דלג'
  if ($null -eq $key) {
    $ans = Show-Message "לפתוח עכשיו את console.anthropic.com כדי ליצור מפתח?`n`n'כן' — נפתח האתר ואחזור לשאול.`n'לא' — נדלג. העוזר לא יעבוד עד שתריץ את UPLOAD-APP שוב עם מפתח." 'Question' 'YesNo'
    if ($ans -eq 'Yes') { Start-Process 'https://console.anthropic.com/settings/keys'; continue }
    break
  }
  if ($key -notmatch '^sk-ant-\S{20,}$') {
    Show-Message "זה לא נראה כמו מפתח של Claude. המפתח מתחיל ב-sk-ant- והוא ארוך. נסה להעתיק שוב." 'Warning' | Out-Null
    continue
  }
  Step 'Saving the key on the server (it is never stored on this computer)'
  $s = Run 'npx.cmd' @('wrangler', 'secret', 'put', 'ANTHROPIC_API_KEY') $key
  $key = $null
  if ($s.Code -eq 0) { break }
  if ((Show-Message "שמירת המפתח נכשלה. לנסות שוב?" 'Warning' 'YesNo') -ne 'Yes') { break }
}

# ---------------- 6. done ----------------

Set-Content -Path (Join-Path $Root 'APP-LINK.txt') -Value $url -Encoding UTF8
try { Set-Clipboard -Value $url } catch { }
Step "Done: $url"

$done = @"
האפליקציה באוויר! 🎉

הקישור שלך:
$url

(הקישור הועתק, ונשמר גם בקובץ APP-LINK.txt בתיקייה.)

איך מתקינים בטלפון:
• אייפון: פתח את הקישור ב-Safari ← כפתור השיתוף ⬆ ← "הוספה למסך הבית".
• אנדרואיד: פתח בכרום ← "התקנת אפליקציה" (או ⋮ ← "הוספה למסך הבית").

לשלוח לך את הקישור לטלפון בוואטסאפ עכשיו?
"@
$ans = Show-Message $done 'Information' 'YesNo'
if ($ans -eq 'Yes') {
  Start-Process ('https://wa.me/?text=' + [uri]::EscapeDataString("האפליקציה שלי: $url"))
}
Start-Process $url
exit 0
