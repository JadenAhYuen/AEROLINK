param(
  [string]$LanIp,
  [string]$TelemetryToken
)

$ErrorActionPreference = "Stop"
$mediaMtxVersion = "1.21.2"
$mediaMtxSha256 = "a84224f5a490855684e62ba6fb71e80ea2a5e16aed61883bb58380290e93e467"
$toolsDirectory = Join-Path $PSScriptRoot ".tools\mediamtx-$mediaMtxVersion"
$mediaMtxExecutable = Join-Path $toolsDirectory "mediamtx.exe"
$runtimeDirectory = Join-Path $PSScriptRoot ".runtime"

function Find-LanIp {
  $defaultRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
    Where-Object { $_.NextHop -ne "0.0.0.0" } |
    Sort-Object RouteMetric, InterfaceMetric |
    Select-Object -First 1

  if (-not $defaultRoute) { return $null }

  return Get-NetIPAddress -InterfaceIndex $defaultRoute.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1 -ExpandProperty IPAddress
}

function Assert-PortAvailable([int]$Port) {
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use. Run .\stop.ps1 or close the application using that port."
  }
}

function Wait-ForPort([int]$Port, [int]$Seconds = 10) {
  for ($attempt = 0; $attempt -lt ($Seconds * 2); $attempt++) {
    if (Test-NetConnection -ComputerName "127.0.0.1" -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Service did not open port $Port within $Seconds seconds."
}

if (-not $LanIp) { $LanIp = Find-LanIp }
if (-not $LanIp) {
  throw "Could not find the laptop LAN address. Run: .\start.ps1 -LanIp 192.168.x.x"
}
$parsedIp = $null
if (-not [System.Net.IPAddress]::TryParse($LanIp, [ref]$parsedIp)) {
  throw "LanIp must be a valid IP address."
}
if ($parsedIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
  throw "LanIp must be an IPv4 address."
}

Assert-PortAvailable 1935
Assert-PortAvailable 3000
Assert-PortAvailable 8889
Assert-PortAvailable 9997
if (Get-NetUDPEndpoint -LocalPort 8189 -ErrorAction SilentlyContinue) {
  throw "UDP port 8189 is already in use. Close the application using that port."
}

if (-not (Test-Path -LiteralPath $mediaMtxExecutable)) {
  New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
  $archivePath = Join-Path ([System.IO.Path]::GetTempPath()) "mediamtx_${mediaMtxVersion}_windows_amd64.zip"
  $downloadUrl = "https://github.com/bluenviron/mediamtx/releases/download/v$mediaMtxVersion/mediamtx_v${mediaMtxVersion}_windows_amd64.zip"

  Write-Host "Downloading MediaMTX $mediaMtxVersion from its official GitHub release..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing
  $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $mediaMtxSha256) {
    Remove-Item -LiteralPath $archivePath -Force
    throw "MediaMTX checksum verification failed. The downloaded file was removed."
  }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsDirectory -Force
  Remove-Item -LiteralPath $archivePath -Force
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$env:MTX_WEBRTCADDITIONALHOSTS = $LanIp
$env:MEDIAMTX_API_URL = "http://127.0.0.1:9997"
$env:MTX_APIADDRESS = "127.0.0.1:9997"
if ($TelemetryToken) { $env:TELEMETRY_TOKEN = $TelemetryToken }

$mediaProcess = Start-Process `
  -FilePath $mediaMtxExecutable `
  -ArgumentList ('"' + (Join-Path $PSScriptRoot "mediamtx.yml") + '"') `
  -WorkingDirectory $PSScriptRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $runtimeDirectory "mediamtx.out.log") `
  -RedirectStandardError (Join-Path $runtimeDirectory "mediamtx.err.log") `
  -PassThru

try {
  Wait-ForPort 1935
  $dashboardProcess = Start-Process `
    -FilePath "node" `
    -ArgumentList "src/server.js" `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDirectory "dashboard.out.log") `
    -RedirectStandardError (Join-Path $runtimeDirectory "dashboard.err.log") `
    -PassThru
  Wait-ForPort 3000
} catch {
  if ($dashboardProcess) {
    Stop-Process -Id $dashboardProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Stop-Process -Id $mediaProcess.Id -Force -ErrorAction SilentlyContinue
  throw
}

@{
  mediaMtx = @{ id = $mediaProcess.Id; started = $mediaProcess.StartTime.ToUniversalTime().ToString("o") }
  dashboard = @{ id = $dashboardProcess.Id; started = $dashboardProcess.StartTime.ToUniversalTime().ToString("o") }
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDirectory "processes.json") -Encoding UTF8

Write-Host ""
Write-Host "AEROLINK is running" -ForegroundColor Green
Write-Host "Dashboard: http://${LanIp}:3000"
Write-Host "DJI RTMP:  rtmp://${LanIp}/x" -ForegroundColor Cyan
Write-Host "Stop with:  .\stop.ps1"
Write-Host ""
Start-Process "http://${LanIp}:3000"
