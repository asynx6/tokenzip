Add-Type -AssemblyName System.Drawing
$dir = 'C:\Users\Administrator\tokenzip\fixtures'

# 1. independent decoder check: open our encoder's output
$b = [System.Drawing.Bitmap]::FromFile("$dir\enc-tz.jpg")
Write-Host "enc-tz.jpg opens in GDI+: $($b.Width)x$($b.Height)"
$b.Dispose()

# 2. GDI+ encoder check: solid red 64x64 for our decoder to read
$bmp = New-Object System.Drawing.Bitmap(64, 64)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 220, 20, 10))
$g.Dispose()
$bmp.Save("$dir\gen-gdi.jpg", [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()
Write-Host "gen-gdi.jpg written by GDI+"
