# Draws a made-up delivery order as a "scanned" JPG in samples/ for trying OCR.
#   powershell -ExecutionPolicy Bypass -File scripts/make-sample-scan.ps1
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\samples\DO-2215 Contoso Power (scan).jpg'
$bmp = New-Object System.Drawing.Bitmap 1700, 2200
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(250, 249, 245))

# A slight tilt makes it look like a real scan.
$g.RotateTransform(0.4)

$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(30, 30, 35))
$title = New-Object System.Drawing.Font 'Arial', 40, ([System.Drawing.FontStyle]::Bold)
$bold = New-Object System.Drawing.Font 'Arial', 26, ([System.Drawing.FontStyle]::Bold)
$body = New-Object System.Drawing.Font 'Arial', 26
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 90, 90)), 2

$g.DrawString('CONTOSO POWER & COOLING', $title, $ink, 120, 120)
$g.DrawString('DELIVERY ORDER  DO-2215', $bold, $ink, 120, 210)
$g.DrawString('Supplier: Contoso Power & Cooling', $body, $ink, 120, 300)
$g.DrawString('Project: DC2 Hall 3 Power', $body, $ink, 120, 350)
$g.DrawString('Date: 09 Oct 2026', $body, $ink, 1100, 300)

$y = 480
$g.DrawLine($pen, 110, $y - 15, 1600, $y - 15)
$g.DrawString('Make', $bold, $ink, 120, $y)
$g.DrawString('Model', $bold, $ink, 420, $y)
$g.DrawString('Qty', $bold, $ink, 900, $y)
$g.DrawString('Serial No.', $bold, $ink, 1060, $y)
$g.DrawLine($pen, 110, $y + 50, 1600, $y + 50)

$rows = @(
  @('Eaton', '9PX 6000i RT3U', '1', 'GA45K12034'),
  @('Eaton', '9PX 6000i RT3U', '1', 'GA45K12035'),
  @('Vertiv', 'Liebert CRV 300', '1', 'CRV3009188A2'),
  @('APC', 'AP8853 Rack PDU', '2', 'ZA2341005521')
)
foreach ($r in $rows) {
  $y += 80
  $g.DrawString($r[0], $body, $ink, 120, $y)
  $g.DrawString($r[1], $body, $ink, 420, $y)
  $g.DrawString($r[2], $body, $ink, 900, $y)
  $g.DrawString($r[3], $body, $ink, 1060, $y)
}
$y += 80
$g.DrawString('ZA2341005522', $body, $ink, 1060, $y)
$g.DrawLine($pen, 110, $y + 60, 1600, $y + 60)
$g.DrawString('Received by: ____________________', $body, $ink, 120, $y + 160)

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 70L
$bmp.Save((Resolve-Path (Split-Path $out)).Path + '\' + (Split-Path $out -Leaf), $codec, $params)
$g.Dispose(); $bmp.Dispose()
Write-Output "Wrote $out"
