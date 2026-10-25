param([string]$NodeExecutable = (Get-Command node -ErrorAction Stop).Source)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$releaseRoot = Join-Path $projectRoot "dist\AEROLINK-$version-windows-x64"
$runtime = Join-Path $releaseRoot 'runtime'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$icon = Join-Path $projectRoot 'desktop\aerolink.ico'
if (-not (Test-Path $icon)) { & (Join-Path $PSScriptRoot 'make-launcher-icon.ps1') }
$mediaRoot = Join-Path $projectRoot '.tools\mediamtx-1.21.2'
if (-not (Test-Path (Join-Path $mediaRoot 'mediamtx.exe'))) { throw 'Run start.ps1 once to download MediaMTX before building.' }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
foreach ($directory in @('src', 'public', 'docs')) {
  $target = Join-Path $releaseRoot $directory
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  & robocopy (Join-Path $projectRoot $directory) $target /E /XF *.gif /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Could not copy $directory" }
}
Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $runtime 'node.exe')
Copy-Item -LiteralPath (Join-Path $mediaRoot 'mediamtx.exe') -Destination $runtime
Copy-Item -LiteralPath (Join-Path $mediaRoot 'LICENSE') -Destination (Join-Path $runtime 'MEDIAMTX-LICENSE.txt')
$nodeVersion = (& $NodeExecutable --version).Trim()
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile (Join-Path $runtime 'NODE-LICENSE.txt')
foreach ($file in @('package.json', 'mediamtx.yml', 'README.md', 'THIRD_PARTY_NOTICES.md')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $releaseRoot
}
& $compiler /nologo /target:winexe /platform:x64 "/win32icon:$icon" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/out:$releaseRoot\AEROLINK.exe" (Join-Path $projectRoot 'desktop\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
$zipPath = "$releaseRoot.zip"
Compress-Archive -LiteralPath $releaseRoot -DestinationPath $zipPath -Force
$archiveStream = [System.IO.File]::OpenRead($zipPath)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try { $checksum = [BitConverter]::ToString($sha256.ComputeHash($archiveStream)).Replace('-', '').ToLowerInvariant() }
finally { $archiveStream.Dispose(); $sha256.Dispose() }
Set-Content -LiteralPath "$zipPath.sha256.txt" -Value "$checksum  $([System.IO.Path]::GetFileName($zipPath))" -Encoding ASCII
Write-Host "SHA256: $checksum"
Write-Host "Release ready: $zipPath"
