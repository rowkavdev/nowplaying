param([string]$Output = "assets/nowplaying.ico")
Add-Type -AssemblyName System.Drawing
$path = Join-Path (Split-Path -Parent $PSScriptRoot) $Output
New-Item (Split-Path -Parent $path) -ItemType Directory -Force | Out-Null
$bitmap = [Drawing.Bitmap]::new(64, 64)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.Color]::FromArgb(13,17,23))
$brush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(88,166,255))
$graphics.FillEllipse($brush, 6, 6, 52, 52)
$play = [Drawing.Point[]]@([Drawing.Point]::new(27,20),[Drawing.Point]::new(27,44),[Drawing.Point]::new(45,32))
$graphics.FillPolygon([Drawing.Brushes]::White, $play)
$icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [IO.File]::Create($path)
try { $icon.Save($stream) } finally { $stream.Dispose(); $icon.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
