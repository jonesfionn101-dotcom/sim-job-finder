# A small always-on-top pop-up at the bottom-right of the main screen, with a
# sound. Used instead of Windows notifications, which didn't show on this PC.
# Closes itself after 20 seconds, or when clicked. "Open" opens the Yes folder.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File popup.ps1 -Title "New job found!" -Body "..."

param([string]$Title = "New job found!", [string]$Body = "Test: this is what an alert looks like.", [string]$Open = "G:\AI_Projects\Job Results\Yes")

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
# The main screen is scaled up: draw at real pixels so text and buttons fit.
Add-Type -Namespace Win -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][Win.Dpi]::SetProcessDPIAware()
[Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object Windows.Forms.Form
$form.AutoScaleMode = "None"; $form.FormBorderStyle = "None"; $form.TopMost = $true; $form.ShowInTaskbar = $false
$form.BackColor = [Drawing.Color]::FromArgb(32, 34, 37); $form.Size = New-Object Drawing.Size(380, 130)
$area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.StartPosition = "Manual"; $form.Location = New-Object Drawing.Point(($area.Right - 400), ($area.Bottom - 150))

$title = New-Object Windows.Forms.Label
$title.Text = $Title; $title.ForeColor = [Drawing.Color]::FromArgb(87, 242, 135)
$title.Font = New-Object Drawing.Font("Segoe UI", 14, [Drawing.FontStyle]::Bold); $title.AutoSize = $true; $title.Location = New-Object Drawing.Point(16, 12)
$body = New-Object Windows.Forms.Label
$body.Text = $Body; $body.ForeColor = [Drawing.Color]::White; $body.Font = New-Object Drawing.Font("Segoe UI", 10)
$body.Size = New-Object Drawing.Size(350, 40); $body.Location = New-Object Drawing.Point(16, 46)
$open = New-Object Windows.Forms.Button
$open.Text = "Open Yes folder"; $open.Size = New-Object Drawing.Size(140, 30); $open.Location = New-Object Drawing.Point(16, 90)
$open.FlatStyle = "Flat"; $open.ForeColor = [Drawing.Color]::White
$open.Add_Click({ Start-Process explorer.exe $Open; $form.Close() })
$close = New-Object Windows.Forms.Button
$close.Text = "Close"; $close.Size = New-Object Drawing.Size(80, 30); $close.Location = New-Object Drawing.Point(166, 90)
$close.FlatStyle = "Flat"; $close.ForeColor = [Drawing.Color]::White
$close.Add_Click({ $form.Close() })
$form.Controls.AddRange(@($title, $body, $open, $close))

$timer = New-Object Windows.Forms.Timer; $timer.Interval = 20000; $timer.Add_Tick({ $form.Close() }); $timer.Start()
$form.Add_Shown({
    $form.Activate()
    try { (New-Object Media.SoundPlayer "C:\Windows\Media\Windows Notify Calendar.wav").Play() } catch { [Media.SystemSounds]::Exclamation.Play() }
})
[void]$form.ShowDialog()
