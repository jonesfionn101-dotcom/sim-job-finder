# A quiet progress pop-up (no voice, no playlist) every time run-latest.ps1 runs,
# so he can see the search is moving even when no ticket job has turned up yet.
# Off switch: put the word "off" in "Job Results\AI only\status-popups.txt".

$root = "G:\AI_Projects\Job Results"
$switch = "$root\AI only\status-popups.txt"
if ((Test-Path -LiteralPath $switch) -and ((Get-Content -LiteralPath $switch -Raw) -match 'off')) { exit 0 }

$repo = "jonesfionn101-dotcom/sim-job-finder"
$runs = gh run list --repo $repo --workflow rules-search.yml --limit 6 --json status,conclusion,createdAt,updatedAt | ConvertFrom-Json
$done = $runs | Where-Object { $_.status -eq "completed" } | Select-Object -First 1
$running = @($runs | Where-Object { $_.status -ne "completed" }).Count -gt 0
$failed = @($runs | Where-Object { $_.conclusion -eq "failure" }).Count
$local = { param($t) ([datetime]$t).ToLocalTime().ToString("HH:mm") }

$feeder = (git -C "G:\AI_Projects\sim-job-finder-public" log -1 --format=%s --grep "Lead feeder") -replace '^Lead feeder[^:]*: ', ''
$toCheck = @(Get-ChildItem -LiteralPath "$root\To check" -File -ErrorAction SilentlyContinue).Count

$lines = @()
$lines += if ($done) { "Last search finished $(& $local $done.updatedAt) ($($done.conclusion))." } else { "No finished search yet." }
$lines += if ($running) { "A new search is running now." } else { "Next search starting soon." }
$lines += "Ticket jobs waiting for you: $toCheck. Feeder: $feeder."
# Short version of the rule-by-rule counts from the latest community search.
$body = gh issue list --repo $repo --state open --search '"📋 Community search" in:title' --json body --jq '.[0].body'
$count = { param($line, $label) if ($line -match "$label`: (\d+)") { $Matches[1] } else { "?" } }
$all = ($body -split "`n" | Where-Object { $_ -like "Rule by rule:*" } | Select-Object -First 1)
$farm = ($body -split "`n" | Where-Object { $_ -like "Farming servers:*" } | Select-Object -First 1)
if ($all) { $lines += "All: $(($all -replace '^Rule by rule: (\d+).*', '$1')) found, $(& $count $all 'hiring a role he wants') hiring, $(& $count $all 'ticket job') ticket jobs." }
if ($farm) { $lines += "Farming: $(($farm -replace '^Farming servers: (\d+).*', '$1')) found, $(& $count $farm 'hiring a role he wants') hiring." }
if ($failed) { $lines += "$failed of the last 6 runs failed - Claude will check." }

$popup = Join-Path $PSScriptRoot "popup.ps1"
Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $popup, '-Title', '"Search update"', '-Body', ('"' + (($lines -join ' ') -replace '"', "'") + '"'))
