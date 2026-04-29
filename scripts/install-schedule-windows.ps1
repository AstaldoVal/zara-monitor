$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Resolve-Path (Join-Path $ScriptDir "..")
$TaskName = "Dex\\ZaraMontenegroMonitor"
$NodePath = (Get-Command node -ErrorAction Stop).Source
$SchedulerScript = Join-Path $AppRoot "src\\scheduler.cjs"

$Action = "`"$NodePath`" `"$SchedulerScript`" --scheduled"

schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
schtasks /Create `
  /TN $TaskName `
  /SC MINUTE `
  /MO 5 `
  /TR $Action `
  /F | Out-Null

Write-Host "Installed Windows task: $TaskName"
Write-Host "Runs every 5 minutes; real execution happens only Mon/Thu 10:00 Montenegro local (default Europe/Podgorica)."
