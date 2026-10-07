# Copies the status of every automatic search (bot) from GitHub into tidy
# folders on this PC:
#
#   G:\AI_Projects\Bot Logs\<bot name>\1 Started\
#                                      \2 In progress\
#                                      \3 Completed\
#                                      \4 Errors\
#
# One small text file per run, named by date and time. When a run moves on
# (started -> in progress -> completed or error), its file moves to the new
# folder. Error files include the failing part of the log.
#
# Runs every 15 minutes through Task Scheduler (no admin needed). The bots
# themselves run on GitHub, so they keep working while the PC is off; this
# script just catches up the next time the PC is on.

$ErrorActionPreference = "Stop"
$Repo = "jonesfionn101-dotcom/sim-job-finder"
$Root = "G:\AI_Projects\Bot Logs"
$Folders = @{ queued = "1 Started"; in_progress = "2 In progress"; completed = "3 Completed"; error = "4 Errors" }

$gh = Join-Path $env:LOCALAPPDATA "GitHubCLI\bin\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

$runs = & $gh run list -R $Repo -L 100 --json databaseId,workflowName,status,conclusion,createdAt,updatedAt,url | ConvertFrom-Json

foreach ($run in $runs) {
  $bot = $run.workflowName -replace '[\\/:*?"<>|]', '-'
  if ($run.status -eq "completed") {
    $stage = if ($run.conclusion -eq "success" -or $run.conclusion -eq "skipped") { "completed" } else { "error" }
  } elseif ($run.status -eq "in_progress") {
    $stage = "in_progress"
  } else {
    $stage = "queued"
  }

  $when = ([datetime]$run.createdAt).ToLocalTime().ToString("yyyy-MM-dd HH.mm")
  $name = "$when - run $($run.databaseId).txt"
  $target = Join-Path (Join-Path $Root $bot) $Folders[$stage]

  foreach ($folder in $Folders.Values) {
    New-Item -ItemType Directory -Force -Path (Join-Path (Join-Path $Root $bot) $folder) | Out-Null
  }

  $already = Join-Path $target $name
  if (Test-Path $already) { continue }

  # The run moved on: remove its file from the earlier stage folders.
  foreach ($folder in $Folders.Values) {
    $old = Join-Path (Join-Path (Join-Path $Root $bot) $folder) $name
    if (Test-Path $old) { Remove-Item $old }
  }

  $lines = @(
    "Bot:      $($run.workflowName)",
    "Started:  $(([datetime]$run.createdAt).ToLocalTime())",
    "Updated:  $(([datetime]$run.updatedAt).ToLocalTime())",
    "Status:   $($run.status) $($run.conclusion)",
    "Watch:    $($run.url)"
  )
  if ($stage -eq "error") {
    $failed = & $gh run view $run.databaseId -R $Repo --log-failed 2>$null | Select-Object -Last 60
    $lines += "", "--- What went wrong (last lines of the failing step) ---", $failed
  }
  Set-Content -Path $already -Value $lines -Encoding utf8
}

Set-Content -Path (Join-Path $Root "last synced.txt") -Value "Last synced from GitHub: $(Get-Date)" -Encoding utf8
