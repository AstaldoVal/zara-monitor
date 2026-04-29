$ErrorActionPreference = "Continue"

$TaskName = "Dex\\ZaraMontenegroMonitor"
schtasks /Query /TN $TaskName /V /FO LIST
