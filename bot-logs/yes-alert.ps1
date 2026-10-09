# Pops up a Windows notification WITH A SOUND whenever something new lands in
# Job Results\Yes, so he never has to check email. Run every 15 minutes by
# run-latest.ps1 (after the folders are sorted). Clicking it opens the Yes folder.
#
#   powershell -ExecutionPolicy Bypass -File yes-alert.ps1 -Test   # hear and see one now

param([switch]$Test)

$yes = "G:\AI_Projects\Job Results\Yes"
$seenFile = "G:\AI_Projects\Job Results\AI only\yes-seen.json"

function Show-Alert([string]$Title, [string]$Body) {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
    $launch = [System.Security.SecurityElement]::Escape("file:///" + ($yes -replace '\\', '/'))
    $xml = @"
<toast launch="$launch" activationType="protocol" scenario="reminder">
  <visual>
    <binding template="ToastGeneric">
      <text>$([System.Security.SecurityElement]::Escape($Title))</text>
      <text>$([System.Security.SecurityElement]::Escape($Body))</text>
    </binding>
  </visual>
  <actions><action content="Open Yes folder" activationType="protocol" arguments="$launch"/></actions>
  <audio src="ms-winsoundevent:Notification.Reminder"/>
</toast>
"@
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    $appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show((New-Object Windows.UI.Notifications.ToastNotification $doc))
}

if ($Test) { Show-Alert "New job found!" "This is what an alert looks like when something lands in your Yes folder."; "test alert sent"; exit 0 }

$seen = @()
if (Test-Path -LiteralPath $seenFile) { try { $seen = @(Get-Content -LiteralPath $seenFile -Raw | ConvertFrom-Json) } catch { $seen = @() } }
$now = @(Get-ChildItem -LiteralPath $yes -File -ErrorAction SilentlyContinue | Where-Object { -not $_.Name.StartsWith("Notes - ") } | ForEach-Object { $_.Name })
$new = @($now | Where-Object { $seen -notcontains $_ })
foreach ($name in $new) {
    Show-Alert "New job found!" ($name -replace '\.md$', '')
    Start-Sleep -Milliseconds 800
}
ConvertTo-Json @($now) | Set-Content -LiteralPath $seenFile -Encoding utf8
"$($new.Count) new in Yes"
