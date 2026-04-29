$ErrorActionPreference = "Continue"

$TaskName = "Dex\\ZaraMontenegroMonitor"
schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
Write-Host "Removed Windows task: $TaskName"
