# A small always-on-top pop-up at the bottom-right of the main screen, with a
# sound. Used instead of Windows notifications, which didn't show on this PC.
# Closes itself after 20 seconds, or when clicked. "Open" opens the Yes folder.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File popup.ps1 -Title "New job found!" -Body "..."

param([string]$Title = "New job found!", [string]$Body = "Test: this is what an alert looks like.", [string]$Job = "")
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
function Move-Job([string]$To) {
    $from = Join-Path "$root\To check" $Job
    if ($Job -and (Test-Path -LiteralPath $from)) { Move-Item -LiteralPath $from -Destination (Join-Path "$root\$To" $Job) -Force }
    $form.Close()
}
$yesButton = New-Button "Yes" 16 70 { Move-Job "Yes" }
$noButton = New-Button "No" 94 70 { Move-Job "No" }
$openButton = New-Button "Open details" 172 120 { Start-Process notepad.exe (Join-Path "$root\To check" $Job) }
$laterButton = New-Button "Later" 300 80 { $form.Close() }
if (-not $Job) { $yesButton.Enabled = $false; $noButton.Enabled = $false; $openButton.Enabled = $false }
$form.Controls.AddRange(@($titleLabel, $bodyLabel, $yesButton, $noButton, $openButton, $laterButton))

# Stays up for a minute; "Later" (or the timeout) leaves the job in "To check".
$timer = New-Object Windows.Forms.Timer; $timer.Interval = 60000; $timer.Add_Tick({ $form.Close() }); $timer.Start()
$form.Add_Shown({
    $form.Activate()
    try { (New-Object Media.SoundPlayer "C:\Windows\Media\Windows Notify Calendar.wav").Play() } catch { [Media.SystemSounds]::Exclamation.Play() }
})
[void]$form.ShowDialog()
