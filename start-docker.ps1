param(
  [string]$LanIp
)

$ErrorActionPreference = "Stop"

if (-not $LanIp) {
  $defaultRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
    Where-Object { $_.NextHop -ne "0.0.0.0" } |
    Sort-Object RouteMetric, InterfaceMetric |
    Select-Object -First 1

  if ($defaultRoute) {
    $LanIp = Get-NetIPAddress -InterfaceIndex $defaultRoute.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike "169.254.*" } |
      Select-Object -First 1 -ExpandProperty IPAddress
  }
}

if (-not $LanIp) {
  throw "Could not find the laptop LAN address. Run: .\start-docker.ps1 -LanIp 192.168.x.x"
}

$env:HOST_IP = $LanIp

Write-Host ""
Write-Host "Lito Flight Monitor" -ForegroundColor Green
Write-Host "Dashboard: http://${LanIp}:3000"
Write-Host "DJI RTMP:  rtmp://${LanIp}/x" -ForegroundColor Cyan
Write-Host ""

docker compose up --build
