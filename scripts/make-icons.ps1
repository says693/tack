# Generates src-tauri/icons/* from a drawn pin-head, no internet, no extra tools.
#   powershell -ExecutionPolicy Bypass -File .\scripts\make-icons.ps1
# Outputs: 32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.ico,
#          nsis-header.bmp (150x57), nsis-sidebar.bmp (164x314)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'src-tauri\icons'
New-Item -ItemType Directory -Force -Path $out | Out-Null

$paper = [System.Drawing.Color]::FromArgb(243, 240, 232)
$ink   = [System.Drawing.Color]::FromArgb(30, 28, 25)
$pin   = [System.Drawing.Color]::FromArgb(181, 67, 42)
$deep  = [System.Drawing.Color]::FromArgb(140, 51, 32)
$quiet = [System.Drawing.Color]::FromArgb(107, 102, 91)

function Add-Pin($g, [float]$cx, [float]$cy, [float]$h) {
    $s = $h / 1024.0
    $head = New-Object System.Drawing.RectangleF ($cx - 300 * $s), ($cy - 178 * $s), (600 * $s), (460 * $s)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $pin), $head)

    $hl = New-Object System.Drawing.RectangleF ($cx - 190 * $s), ($cy - 62 * $s), (188 * $s), (116 * $s)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(235, 255, 244, 236))), $hl)

    $collar = New-Object System.Drawing.RectangleF ($cx - 256 * $s), ($cy + 108 * $s), (512 * $s), (86 * $s)
    $r = 43 * $s
    $pc = New-Object System.Drawing.Drawing2D.GraphicsPath
    $pc.AddArc($collar.X, $collar.Y, $r * 2, $r * 2, 90, 180)
    $pc.AddArc($collar.Right - $r * 2, $collar.Y, $r * 2, $r * 2, 270, 180)
    $pc.AddArc($collar.Right - $r * 2, $collar.Bottom - $r * 2, $r * 2, $r * 2, 0, 180)
    $pc.AddArc($collar.X, $collar.Bottom - $r * 2, $r * 2, $r * 2, 90, 180)
    $pc.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush $deep), $pc)

    $needle = New-Object System.Drawing.RectangleF ($cx - 46 * $s), ($cy + 178 * $s), (92 * $s), (270 * $s)
    $rn = 46 * $s
    $pn = New-Object System.Drawing.Drawing2D.GraphicsPath
    $pn.AddArc($needle.X, $needle.Y, $rn * 2, $rn * 2, 180, 180)
    $pn.AddArc($needle.Right - $rn * 2, $needle.Y, $rn * 2, $rn * 2, 270, 180)
    $pn.AddLine($needle.Right, $needle.Bottom, $needle.X, $needle.Bottom)
    $pn.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush $deep), $pn)

    $tip = New-Object System.Drawing.PointF[] 3
    $tip[0] = New-Object System.Drawing.PointF ($cx - 46 * $s), ($cy + 432 * $s)
    $tip[1] = New-Object System.Drawing.PointF ($cx + 46 * $s), ($cy + 432 * $s)
    $tip[2] = New-Object System.Drawing.PointF $cx, ($cy + 512 * $s)
    $g.FillPolygon((New-Object System.Drawing.SolidBrush $ink), $tip)
}

function New-AppBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear($paper)
    Add-Pin $g ($size / 2.0) ($size * 0.40) ($size * 0.9)
    $g.Dispose()
    return $bmp
}

function Save-Png([int]$size, [string]$name) {
    $bmp = New-AppBitmap $size
    $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "   wrote $name ($size px)"
}

Save-Png 32  '32x32.png'
Save-Png 128 '128x128.png'
Save-Png 256 '128x128@2x.png'
Save-Png 512 'icon.png'

# .ico: header + one entry + embedded PNG (Vista+ supports PNG-in-ICO)
$bmp256 = New-AppBitmap 256
$ms = New-Object System.IO.MemoryStream
$bmp256.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp256.Dispose()
$icoPng = $ms.ToArray()
$ms.Dispose()

$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ico
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$icoPng.Length); $bw.Write([UInt32]22)
$bw.Write($icoPng)
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $out 'icon.ico'), $ico.ToArray())
$bw.Dispose(); $ico.Dispose()
Write-Host '   wrote icon.ico (256 px)'

# NSIS installer chrome: 24-bit BMP, bottom-up rows, BGR, 4-byte aligned.
function Save-Bmp24($bmp, [string]$path) {
    $w = $bmp.Width; $h = $bmp.Height
    $rowSize = [math]::Floor((($w * 3) + 3) / 4) * 4
    $pixelBytes = $rowSize * $h
    $fileSize = 54 + $pixelBytes
    $fs = [System.IO.File]::Create($path)
    $bw = New-Object System.IO.BinaryWriter $fs
    $bw.Write([Byte]'B'); $bw.Write([Byte]'M')
    $bw.Write([Int32]$fileSize); $bw.Write([Int32]0); $bw.Write([Int32]54)
    $bw.Write([Int32]40); $bw.Write([Int32]$w); $bw.Write([Int32]$h)
    $bw.Write([Int16]1); $bw.Write([Int16]24)
    $bw.Write([Int32]0); $bw.Write([Int32]$pixelBytes)
    $bw.Write([Int32]2835); $bw.Write([Int32]2835); $bw.Write([Int32]0); $bw.Write([Int32]0)
    $pad = New-Object byte[] ($rowSize - $w * 3)
    for ($y = $h - 1; $y -ge 0; $y--) {
        for ($x = 0; $x -lt $w; $x++) {
            $c = $bmp.GetPixel($x, $y)
            $bw.Write($c.B); $bw.Write($c.G); $bw.Write($c.R)
        }
        $bw.Write($pad)
    }
    $bw.Dispose(); $fs.Dispose()
}

# header 150x57: wordmark left, pin right
$hb = New-Object System.Drawing.Bitmap 150, 57
$hg = [System.Drawing.Graphics]::FromImage($hb)
$hg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$hg.Clear($paper)
$fWord = New-Object System.Drawing.Font 'Georgia', 20, ([System.Drawing.FontStyle]::Italic)
$hg.DrawString('tack', $fWord, (New-Object System.Drawing.SolidBrush $ink), 12, 8)
$fSub = New-Object System.Drawing.Font 'Segoe UI', 7.5
$hg.DrawString('知识钉板', $fSub, (New-Object System.Drawing.SolidBrush $quiet), 14, 38)
Add-Pin $hg 118 30 64
$hg.Dispose()
Save-Bmp24 $hb (Join-Path $out 'nsis-header.bmp')
$hb.Dispose()
Write-Host '   wrote nsis-header.bmp (150x57)'

# sidebar 164x314: big pin, vertical caption
$sb = New-Object System.Drawing.Bitmap 164, 314
$sg = [System.Drawing.Graphics]::FromImage($sb)
$sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$sg.Clear($paper)
Add-Pin $sg 82 150 132
$fCap = New-Object System.Drawing.Font 'Microsoft YaHei', 13
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$sg.DrawString('钉住', $fCap, (New-Object System.Drawing.SolidBrush $ink), (New-Object System.Drawing.RectangleF 0, 236, 164, 30), $fmt)
$fCap2 = New-Object System.Drawing.Font 'Microsoft YaHei', 9
$sg.DrawString('每天回来一次', $fCap2, (New-Object System.Drawing.SolidBrush $quiet), (New-Object System.Drawing.RectangleF 0, 266, 164, 24), $fmt)
$sg.Dispose()
Save-Bmp24 $sb (Join-Path $out 'nsis-sidebar.bmp')
$sb.Dispose()
Write-Host '   wrote nsis-sidebar.bmp (164x314)'

Write-Host '   note: macOS .icns is generated by the tauri CLI during packaging (npx tauri icon ui/icons/pin.svg).'
Write-Host '   done.'
