# A.U.R.A easy updater (Windows / PowerShell).
# Pulls the latest code and auto-stashes any local edits, then reapplies them.
# Your data/ and targets/ folders are git-ignored, so scans and project configs are never touched.
$ErrorActionPreference = "Stop"
Write-Host "Updating A.U.R.A (your data/ and targets/ are never modified)..." -ForegroundColor Cyan
git pull --rebase --autostash
if ($LASTEXITCODE -eq 0) {
  Write-Host "Up to date. Restart the server to load changes." -ForegroundColor Green
} else {
  Write-Host "Pull finished with conflicts to resolve. Your data/ and targets/ were not touched." -ForegroundColor Yellow
}
