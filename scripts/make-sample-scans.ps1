# Draws made-up scanned documents for trying OCR, including badly scanned ones
# and images with nothing relevant on them. Writes into samples/.
#   powershell -ExecutionPolicy Bypass -File scripts/make-sample-scans.ps1
# Run this before `npm run samples`, which builds PDFs and zips from some of these.
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$samples = Join-Path $root 'samples'
foreach ($d in 'damaged', 'unrelated') { New-Item -ItemType Directory -Force (Join-Path $samples $d) | Out-Null }
$rand = New-Object System.Random 42   # fixed seed: same images every run

function Save-Jpeg($bmp, $path, [long]$quality) {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $params = New-Object System.Drawing.Imaging.EncoderParameters 1
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $quality
  $bmp.Save($path, $codec, $params)
}

function New-Page([int]$w, [int]$h, $paper) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear($paper)
  return @{ Bmp = $bmp; G = $g }
}

# Draws a delivery order: heading lines, then a Make / Model / Qty / Serial table.
function Draw-Order($g, $ink, $title, $lines, $rows, [float]$scale) {
  $titleFont = New-Object System.Drawing.Font 'Arial', (34 * $scale), ([System.Drawing.FontStyle]::Bold)
  $bold = New-Object System.Drawing.Font 'Arial', (24 * $scale), ([System.Drawing.FontStyle]::Bold)
  $body = New-Object System.Drawing.Font 'Arial', (24 * $scale)
  $pen = New-Object System.Drawing.Pen $ink, 2
  $brush = New-Object System.Drawing.SolidBrush $ink
  $x = 110 * $scale; $y = 110 * $scale
  $g.DrawString($title, $titleFont, $brush, $x, $y)
  $y += 90 * $scale
  foreach ($l in $lines) { $g.DrawString($l, $body, $brush, $x, $y); $y += 48 * $scale }
  $y += 50 * $scale
  $cols = @(110, 400, 900, 1050) | ForEach-Object { $_ * $scale }
  $g.DrawLine($pen, 100 * $scale, $y - 14 * $scale, 1600 * $scale, $y - 14 * $scale)
  $heads = 'Make', 'Model', 'Qty', 'Serial No.'
  for ($i = 0; $i -lt 4; $i++) { $g.DrawString($heads[$i], $bold, $brush, $cols[$i], $y) }
  $g.DrawLine($pen, 100 * $scale, $y + 46 * $scale, 1600 * $scale, $y + 46 * $scale)
  $positions = @()
  foreach ($r in $rows) {
    $y += 76 * $scale
    for ($i = 0; $i -lt 4; $i++) { $g.DrawString($r[$i], $body, $brush, $cols[$i], $y) }
    $positions += $y
  }
  return $positions
}

function Add-Speckle($g, $w, $h, [int]$count, [int]$alpha) {
  for ($i = 0; $i -lt $count; $i++) {
    $c = [System.Drawing.Color]::FromArgb($rand.Next(20, $alpha), 40, 40, 40)
    $s = $rand.Next(1, 4)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $c), $rand.Next(0, $w), $rand.Next(0, $h), $s, $s)
  }
}

# Re-samples an image down and back up, which blurs it like a cheap scanner.
function Blur($bmp, [float]$factor) {
  $small = New-Object System.Drawing.Bitmap ([int]($bmp.Width * $factor)), ([int]($bmp.Height * $factor))
  $gs = [System.Drawing.Graphics]::FromImage($small)
  $gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
  $gs.DrawImage($bmp, 0, 0, $small.Width, $small.Height)
  $out = New-Object System.Drawing.Bitmap $bmp.Width, $bmp.Height
  $go = [System.Drawing.Graphics]::FromImage($out)
  $go.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
  $go.DrawImage($small, 0, 0, $out.Width, $out.Height)
  $gs.Dispose(); $go.Dispose(); $small.Dispose()
  return $out
}

$paper = [System.Drawing.Color]::FromArgb(246, 244, 236)
$ink = [System.Drawing.Color]::FromArgb(35, 35, 40)

# 1. Coffee stain over one serial number, tilted, speckled.
$p = New-Page 1700 2200 $paper
$p.G.RotateTransform(1.2)
$ys = Draw-Order $p.G $ink 'MERIDIAN DATA SYSTEMS' @('DELIVERY ORDER  DO-3307', 'Supplier: Meridian Data Systems', 'Project: DC1 Storage Expansion') @(
  @('NetApp', 'AFF A250', '1', '721934000123'),
  @('NetApp', 'DS224C Shelf', '1', '721934000456'),
  @('Cisco', 'N9K-C93180YC-FX', '1', 'FDO24310ABC'),
  @('Cisco', 'N9K-C93180YC-FX', '1', 'FDO24310ABD')
) 1
$p.G.ResetTransform()
$stain = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 120, 80, 40))
$p.G.FillEllipse($stain, 980, $ys[1] - 30, 300, 120)   # covers most of the second serial
$p.G.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 120, 80, 40))), 930, $ys[1] - 60, 400, 180)
Add-Speckle $p.G 1700 2200 15000 120
$out = Blur $p.Bmp 0.6
Save-Jpeg $out (Join-Path $samples 'damaged\DO-3307 Meridian (coffee stain).jpg') 60
$p.G.Dispose(); $p.Bmp.Dispose(); $out.Dispose()

# 2. Faded fax: grey ink, low resolution, heavy compression.
$p = New-Page 1700 2200 ([System.Drawing.Color]::FromArgb(238, 238, 238))
Draw-Order $p.G ([System.Drawing.Color]::FromArgb(150, 150, 150)) 'ORION NETWORKS' @('FAX - DELIVERY ORDER DO-3310', 'Supplier: Orion Networks', 'Project: Branch Office Refresh') @(
  @('Juniper', 'EX4400-48P', '1', 'XH3122AF0012'),
  @('Juniper', 'EX4400-48P', '1', 'XH3122AF0013'),
  @('Fortinet', 'FortiGate 100F', '1', 'FG100FTK21004567')
) 1 | Out-Null
Add-Speckle $p.G 1700 2200 25000 90
$small = New-Object System.Drawing.Bitmap 760, 983
$gs = [System.Drawing.Graphics]::FromImage($small)
$gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$gs.DrawImage($p.Bmp, 0, 0, 760, 983)
Save-Jpeg $small (Join-Path $samples 'damaged\DO-3310 Orion (faded fax).jpg') 25
$gs.Dispose(); $small.Dispose(); $p.G.Dispose(); $p.Bmp.Dispose()

# 3. Torn page: the bottom rows are missing and a fold crosses one serial.
$p = New-Page 1700 1500 $paper
$ys = Draw-Order $p.G $ink 'CONTOSO POWER & COOLING' @('COMPLETION DOCUMENT  CD-0412', 'Supplier: Contoso Power & Cooling', 'Project: DC2 Hall 3 Power') @(
  @('Vertiv', 'Liebert APM 150', '1', 'APM1509921B'),
  @('Eaton', '93PM 50kW', '1', 'EA93P5003341'),
  @('Schneider', 'Galaxy VS 40kW', '1', 'GVS40211877'),
  @('APC', 'AP8853 Rack PDU', '4', 'ZA2341005600')
) 1
$fold = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 60, 60, 60)), 10
$p.G.DrawLine($fold, 0, $ys[2] + 18, 1700, $ys[2] + 8)   # fold line through the third row
# Torn edge: everything below a jagged line is gone.
$tear = New-Object System.Collections.Generic.List[System.Drawing.PointF]
$tear.Add((New-Object System.Drawing.PointF 0, 1500))
for ($x = 0; $x -le 1700; $x += 40) { $tear.Add((New-Object System.Drawing.PointF $x, ($ys[3] + 10 + $rand.Next(-25, 25)))) }
$tear.Add((New-Object System.Drawing.PointF 1700, 1500))
$p.G.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 62, 66))), $tear.ToArray())
Add-Speckle $p.G 1700 1500 6000 100
$p.Bmp.Save((Join-Path $samples 'damaged\CD-0412 Contoso (torn page).png'), [System.Drawing.Imaging.ImageFormat]::Png)
$p.G.Dispose(); $p.Bmp.Dispose()

# 4. Unrelated: a photo-like picture of a rack with no text at all.
$p = New-Page 1200 900 ([System.Drawing.Color]::FromArgb(28, 30, 34))
$p.G.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(55, 58, 64))), 380, 60, 440, 800)
for ($u = 0; $u -lt 14; $u++) {
  $y = 90 + $u * 54
  $p.G.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(80, 84, 92))), 400, $y, 400, 44)
  for ($l = 0; $l -lt 4; $l++) {
    $c = if ($rand.Next(0, 5) -eq 0) { [System.Drawing.Color]::FromArgb(255, 170, 40) } else { [System.Drawing.Color]::FromArgb(60, 220, 120) }
    $p.G.FillEllipse((New-Object System.Drawing.SolidBrush $c), 420 + $l * 18, $y + 16, 9, 9)
  }
}
Add-Speckle $p.G 1200 900 8000 60
Save-Jpeg $p.Bmp (Join-Path $samples 'unrelated\Rack photo.jpg') 80
$p.G.Dispose(); $p.Bmp.Dispose()

# 5. Unrelated: whiteboard notes with text but no equipment details.
$p = New-Page 1600 1000 ([System.Drawing.Color]::FromArgb(250, 250, 248))
$marker = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(30, 60, 160))
$hand = New-Object System.Drawing.Font 'Comic Sans MS', 40
$y = 80
foreach ($l in 'Sprint planning - 14 Oct', '- Team lunch Friday 12:30', '- Book training room for onboarding', '- Review leave roster before Dec', '- Ask facilities about aircon noise') {
  $p.G.DrawString($l, $hand, $marker, 90, $y); $y += 120
}
Save-Jpeg $p.Bmp (Join-Path $samples 'unrelated\Whiteboard notes.jpg') 75
$p.G.Dispose(); $p.Bmp.Dispose()

Write-Output 'Sample scans written.'
