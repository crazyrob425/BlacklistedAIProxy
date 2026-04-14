# installer/assets/README.md

## Installer Wizard Artwork Assets

Place your custom bitmap files in this directory before running the Inno Setup compiler.

| File | Size | Usage |
|------|------|-------|
| `WizardImage.bmp` | 164 × 314 px | Left-side banner on all wizard pages |
| `WizardSmallImage.bmp` | 55 × 55 px | Top-right icon on inner pages |
| `SetupIcon.ico` | 256×256, 128×128, 64×64, 32×32, 16×16 | Installer .exe taskbar/window icon |
| `UninstallerIcon.ico` | Same sizes as above | Uninstaller .exe icon |

### Requirements

- `WizardImage.bmp` and `WizardSmallImage.bmp` must be **24-bit BMP** (no alpha channel).
- Inno Setup will fall back to its built-in defaults if these files are missing.
- For best results use the Blacklisted Binary Labs brand colours:
  - Background: `#0D0D0D` (near-black)
  - Accent: `#00B4FF` (electric blue)
  - Text: `#FFFFFF` (white)

### Generating placeholder assets (no design tools needed)

Run the following PowerShell one-liner on Windows to generate solid-colour placeholder BMPs:

```powershell
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(164, 314)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(13, 13, 13))
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 180, 255))
$font  = New-Object System.Drawing.Font("Arial", 12, [System.Drawing.FontStyle]::Bold)
$g.DrawString("BlacklistedAIProxy", $font, $brush, 10, 140)
$bmp.Save("WizardImage.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

$bmp2 = New-Object System.Drawing.Bitmap(55, 55)
$g2   = [System.Drawing.Graphics]::FromImage($bmp2)
$g2.Clear([System.Drawing.Color]::FromArgb(0, 180, 255))
$bmp2.Save("WizardSmallImage.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp2.Dispose()
```
