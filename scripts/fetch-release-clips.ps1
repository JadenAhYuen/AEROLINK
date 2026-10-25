$ErrorActionPreference = 'Stop'
$destination = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\assets\broll'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$clips = [ordered]@{
  '3115506-uhd_3840_2160_24fps.mp4' = '74025aab249614f1e67a853f1fb0e1003bff186a379db33679a0318a0541ba7f'
  '5646564-hd_1920_1080_30fps.mp4' = '3a868d1ad9b7f7768ab88bba7aa7a727064209ee32bd6b6ce3d9cc73d9695145'
  '6003440-uhd_3840_2160_25fps.mp4' = '3811708890269f1c4d0f2fc2e3671ad7758649bea6befea85ad3728fd9af6c98'
  '6003442-uhd_3840_2160_25fps.mp4' = 'dc6c0ff9a9e8e2a118d1b249c81eec32872bbffd55e98ce9b17cff4f5d181507'
  '6051207-uhd_3840_2160_25fps.mp4' = 'bfacb6fc2b436aa197edb9bf5d52bac843365f692af3dc1c8db5b151a507a7ca'
  '6611654-hd_1920_1080_30fps.mp4' = '1856ab6aca63cad6dd3f8681f377f4e77458b72d5e3e44a7ce6879444dd19587'
  '6981339-hd_1920_1080_25fps.mp4' = '648df497ed74c950aa9881690f4ef33b8a36cea9f7d0af2a3615cf49008b08b6'
}
foreach ($name in $clips.Keys) {
  $id = $name.Split('-')[0]
  $file = Join-Path $destination $name
  if (-not (Test-Path -LiteralPath $file)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://videos.pexels.com/video-files/$id/$name" -OutFile $file
  }
  $stream = [System.IO.File]::OpenRead($file)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $hasher.Dispose() }
  if ($hash -ne $clips[$name]) { throw "Video checksum mismatch: $name" }
  Write-Host "Verified $name"
}
