# Pops up a Windows notification WITH A SOUND whenever something new lands in
# Job Results\Yes, so he never has to check email. Run every 15 minutes by
# run-latest.ps1 (after the folders are sorted). Clicking it opens the Yes folder.
#
#   powershell -ExecutionPolicy Bypass -File yes-alert.ps1 -Test   # hear and see one now

param([switch]$Test)

$yes = "G:\AI_Projects\Job Results\Yes"
$seenFile = "G:\AI_Projects\Job Results\AI only\yes-seen.json"

# Uses popup.ps1 (our own pop-up with sound): Windows notifications don't show on this PC.
function Show-Alert([string]$Title, [string]$Body) {
    Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'popup.ps1'), '-Title', $Title, '-Body', $Body)
}

# The job's name plus its first link, read from the Yes file.
function Get-JobSummary([string]$File) {
    $text = Get-Content -LiteralPath (Join-Path $yes $File) -Raw
    $name = ($text -split "`n")[0] -replace '^#\s*\S*\s*', ''
    $link = [regex]::Match($text, 'https?://\S+').Value
    if ($link) { "$name`n$link" } else { $name }
}

if ($Test) { Show-Alert "New job found!" "This is what an alert looks like when something lands in your Yes folder."; "test alert sent"; exit 0 }

$seen = @()
if (Test-Path -LiteralPath $seenFile) { try { $seen = @(Get-Content -LiteralPath $seenFile -Raw | ConvertFrom-Json) } catch { $seen = @() } }
$now = @(Get-ChildItem -LiteralPath $yes -File -ErrorAction SilentlyContinue | Where-Object { -not $_.Name.StartsWith("Notes - ") } | ForEach-Object { $_.Name })
$new = @($now | Where-Object { $seen -notcontains $_ })
foreach ($name in $new) {
    Show-Alert "New job found!" (Get-JobSummary $name)
    Start-Sleep -Milliseconds 800
}
ConvertTo-Json @($now) | Set-Content -LiteralPath $seenFile -Encoding utf8
"$($new.Count) new in Yes"
