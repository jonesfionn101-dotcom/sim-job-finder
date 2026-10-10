# A small always-on-top pop-up at the bottom-right of the main screen, with a
# sound. Used instead of Windows notifications, which didn't show on this PC.
# Closes itself after 20 seconds, or when clicked. "Open" opens the Yes folder.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File popup.ps1 -Title "New job found!" -Body "..."

param([string]$Title = "New job found!", [string]$Body = "Test: this is what an alert looks like.", [string]$Job = "", [switch]$Reminder)
# $Job = a file in "To check". Yes/No move it into his Yes or No folder (10 Oct 2026).
$root = "G:\AI_Projects\Job Results"

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
# The main screen is scaled up: draw at real pixels so text and buttons fit.
Add-Type -Namespace Win -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][Win.Dpi]::SetProcessDPIAware()
[Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object Windows.Forms.Form
$form.AutoScaleMode = "None"; $form.FormBorderStyle = "None"; $form.TopMost = $true; $form.ShowInTaskbar = $false
$form.BackColor = [Drawing.Color]::FromArgb(32, 34, 37); $form.Size = New-Object Drawing.Size(420, 140)
$area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.StartPosition = "Manual"; $form.Location = New-Object Drawing.Point(($area.Right - 440), ($area.Bottom - 160))

$titleLabel = New-Object Windows.Forms.Label
$titleLabel.Text = $Title; $titleLabel.ForeColor = [Drawing.Color]::FromArgb(87, 242, 135)
$titleLabel.Font = New-Object Drawing.Font("Segoe UI", 14, [Drawing.FontStyle]::Bold); $titleLabel.AutoSize = $true; $titleLabel.Location = New-Object Drawing.Point(16, 12)
$bodyLabel = New-Object Windows.Forms.Label
$bodyLabel.Text = $Body; $bodyLabel.ForeColor = [Drawing.Color]::White; $bodyLabel.Font = New-Object Drawing.Font("Segoe UI", 10)
$bodyLabel.Size = New-Object Drawing.Size(390, 46); $bodyLabel.Location = New-Object Drawing.Point(16, 46)
function New-Button([string]$Text, [int]$X, [int]$Width, [scriptblock]$OnClick) {
    $button = New-Object Windows.Forms.Button
    $button.Text = $Text; $button.Size = New-Object Drawing.Size($Width, 30); $button.Location = New-Object Drawing.Point($X, 98)
    $button.FlatStyle = "Flat"; $button.ForeColor = [Drawing.Color]::White
    $button.Add_Click($OnClick)
    $button
}
function Open-Playlist { Start-Process "spotify:playlist:7eFSKKmYgWY0D4KxdAvnXo" }

function Move-Job([string]$To) {
    # A song for his answer too, Yes or No.
    if ($Job) { Open-Playlist }
    $from = Join-Path "$root\To check" $Job
    if ($Job -and (Test-Path -LiteralPath $from)) {
        # Yes also opens the server's page so he can join and apply straight away.
        # Prefer a Discord invite; otherwise the first link (e.g. the server's list page).
        $text = Get-Content -LiteralPath $from -Raw
        $link = [regex]::Match($text, 'https://discord\.(gg|com/invite)/\S+').Value
        if (-not $link) { $link = [regex]::Match($text, 'https?://\S+').Value }
        Move-Item -LiteralPath $from -Destination (Join-Path "$root\$To" $Job) -Force
        $script:answered = $true
        if ($To -eq "Yes" -and $link) { Start-Process ($link.TrimEnd(')', '.', ',')) }
    }
    $form.Close()
}
$yesButton = New-Button "Yes" 16 70 { Move-Job "Yes" }
$noButton = New-Button "No" 94 70 { Move-Job "No" }
# Voice for JOB ALERTS ONLY (he asked, 10 Oct 2026). Nothing else on the PC talks.
# Off switch: put the word "off" in "Job Results\AI only\alert-voice.txt".
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voiceFile = "$root\AI only\alert-voice.txt"
$voiceOn = -not ((Test-Path -LiteralPath $voiceFile) -and ((Get-Content -LiteralPath $voiceFile -Raw) -match 'off'))

# The job file as plain spoken sentences: no markdown, no links.
function Get-SpokenDetails {
    $file = Join-Path "$root\To check" $Job
    if (-not (Test-Path -LiteralPath $file)) { return "I can't find the details for this job." }
    (Get-Content -LiteralPath $file) |
        Where-Object { $_ -notmatch '^\s*$' -and $_ -notmatch '^(From:|🆕)' -and $_ -notmatch '^- (Open|Check inside):' } |
        ForEach-Object { ($_ -replace 'https?://\S+', '' -replace '[#*`>_]', '' -replace '^\s*-\s*', '' -replace '\s+', ' ').Trim() } |
        Where-Object { $_ } |
        ForEach-Object { if ($_ -match '[.!?]$') { $_ } else { "$_." } }
}

# "Read details" reads the job out loud (no Notepad); click again to stop.
# Reading it keeps the pop-up open until he picks Yes, No or Later.
$openButton = New-Button "Read details" 172 120 {
    $timer.Stop()
    if ($voice.State -eq "Speaking") { $voice.SpeakAsyncCancelAll(); return }
    $voice.SpeakAsync((Get-SpokenDetails) -join " ") | Out-Null
}
# "Later" (or ignoring it) brings the same job back 5 minutes later, until he answers Yes or No.
$script:answered = $false
function Request-Reminder {
    if ($script:answered -or -not $Job) { return }
    $again = "Start-Sleep 300; if (Test-Path -LiteralPath '$root\To check\$($Job -replace "'", "''")') { & '$PSCommandPath' -Title '$($Title -replace "'", "''")' -Body '$($Body -replace "'", "''")' -Job '$($Job -replace "'", "''")' -Reminder }"
    Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $again)
}
$laterButton = New-Button "Later" 300 80 { $form.Close() }
$form.Add_FormClosed({ Request-Reminder })
$form.Add_FormClosing({ $voice.SpeakAsyncCancelAll() })
# Updates (no job): hide the job buttons and give the message the room instead.
if (-not $Job) {
    $yesButton.Visible = $false; $noButton.Visible = $false; $openButton.Visible = $false
    $bodyLabel.Size = New-Object Drawing.Size(390, 80)
    $laterButton.Text = "OK"; $laterButton.Location = New-Object Drawing.Point(16, 128)
    $form.Size = New-Object Drawing.Size(420, 172)
    $form.Location = New-Object Drawing.Point(($area.Right - 440), ($area.Bottom - 192))
}
$form.Controls.AddRange(@($titleLabel, $bodyLabel, $yesButton, $noButton, $openButton, $laterButton))

# Stays up for a minute; "Later" (or the timeout) leaves the job in "To check".
$timer = New-Object Windows.Forms.Timer; $timer.Interval = 60000; $timer.Add_Tick({ $form.Close() }); $timer.Start()
$form.Add_Shown({
    $form.Activate()
    try { (New-Object Media.SoundPlayer "C:\Windows\Media\Windows Notify Calendar.wav").PlaySync() } catch { [Media.SystemSounds]::Exclamation.Play() }
    # After the chime, say what was found.
    if ($voiceOn -and $Job) { $voice.SpeakAsync("$Title $($Body -replace 'https?://\S+', '')") | Out-Null }
    # His alert playlist opens in Spotify on every job pop-up, reminders included
    # (Spotify Free won't let other programs press play, so he presses it).
    if ($Job) { Open-Playlist }
})
[void]$form.ShowDialog()
