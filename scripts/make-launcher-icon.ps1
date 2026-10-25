$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'desktop\aerolink.ico'
$bitmap = New-Object System.Drawing.Bitmap(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$background = New-Object System.Drawing.Drawing2D.GraphicsPath
$background.AddArc(8, 8, 76, 76, 180, 90)
$background.AddArc(172, 8, 76, 76, 270, 90)
$background.AddArc(172, 172, 76, 76, 0, 90)
$background.AddArc(8, 172, 76, 76, 90, 90)
$background.CloseFigure()
$graphics.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(12, 26, 39))), $background)
function Draw-Polygon($color, [float[]]$coordinates) {
  $points = New-Object 'System.Drawing.PointF[]' ($coordinates.Length / 2)
  for ($i = 0; $i -lt $points.Length; $i++) {
    $points[$i] = New-Object System.Drawing.PointF([float]($coordinates[$i * 2] * 3.2 + 25.6), [float]($coordinates[$i * 2 + 1] * 3.2 + 25.6))
  }
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($color))
  $graphics.FillPolygon($brush, $points)
  $brush.Dispose()
}
Draw-Polygon '#91C8FF' ([float[]]@(11,44,32,8,53,44,32,35))
Draw-Polygon '#3E89D6' ([float[]]@(11,44,32,35,53,44,32,56))
Draw-Polygon '#E8F4FF' ([float[]]@(32,8,40,37,32,35,24,37))
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#07131E'))
$graphics.FillEllipse($brush, 115, 115, 26, 26)
$brush.Dispose()
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $stream.ToArray()
$file = [System.IO.File]::Create($output)
$writer = New-Object System.IO.BinaryWriter($file)
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
  $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22)
  $writer.Write($png)
} finally { $writer.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose(); $background.Dispose() }
Write-Host "Launcher icon: $output"
