$ErrorActionPreference = "Stop"
$processFile = Join-Path $PSScriptRoot ".runtime\processes.json"

if (-not (Test-Path -LiteralPath $processFile)) {
  Write-Host "No Lito Flight Monitor process record was found."
  exit 0
}

$record = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
foreach ($entryName in @("dashboard", "mediaMtx")) {
  $entry = $record.$entryName
  $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
  if (-not $process) { continue }

  $recordedStart = [DateTime]::Parse($entry.started).ToUniversalTime()
  $actualStart = $process.StartTime.ToUniversalTime()
  if ([Math]::Abs(($actualStart - $recordedStart).TotalSeconds) -lt 2) {
    Stop-Process -Id $process.Id
    Write-Host "Stopped $entryName (PID $($process.Id))."
  } else {
    Write-Warning "PID $($entry.id) now belongs to a different process and was not stopped."
  }
}

Remove-Item -LiteralPath $processFile -Force

