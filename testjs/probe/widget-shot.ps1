# Screenshot the desktop widget window: raise it temporarily, capture its rect, put it back
# below the first visible window above Progman (i.e. back into "bottom mode").
# ASCII only.
param(
  [string]$Out = '',
  [int]$Pad = 14
)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WS2 {
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
}
'@
Add-Type -AssemblyName System.Drawing, System.Windows.Forms

[void][WS2]::SetProcessDPIAware()
$shell = [WS2]::GetShellWindow()

function Get-Cls([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 256
  [void][WS2]::GetClassNameW($h, $sb, 256)
  return $sb.ToString()
}

# find the widget among Progman's siblings
$w = [IntPtr]::Zero
$h = [WS2]::GetWindow($shell, 3)
for ($i = 0; $i -lt 14 -and $h -ne [IntPtr]::Zero; $i++) {
  $r = New-Object WS2+RECT
  [void][WS2]::GetWindowRect($h, [ref]$r)
  $wd = $r.right - $r.left
  $ht = $r.bottom - $r.top
  if ((Get-Cls $h) -eq 'Chrome_WidgetWin_1' -and $wd -ge 300 -and $wd -le 500 -and $ht -gt 600 -and $r.left -gt -1000) { $w = $h; break }
  $h = [WS2]::GetWindow($h, 3)
}
if ($w -eq [IntPtr]::Zero) { Write-Output 'widget not found'; exit 2 }

$r0 = New-Object WS2+RECT
[void][WS2]::GetWindowRect($w, [ref]$r0)
Write-Output "widget=0x$($w.ToString('X')) rect=$($r0.left),$($r0.top) $($r0.right - $r0.left)x$($r0.bottom - $r0.top)"

# raise to top so the capture is not covered by app windows
[void][WS2]::SetWindowPos($w, [IntPtr]::Zero, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010)
Start-Sleep -Milliseconds 350

$r = New-Object WS2+RECT
[void][WS2]::GetWindowRect($w, [ref]$r)
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$x = [Math]::Max(0, $r.left - $Pad)
$y = [Math]::Max(0, $r.top - $Pad)
$cw = [Math]::Min($b.Width - $x, ($r.right - $r.left) + $Pad * 2)
$ch = [Math]::Min($b.Height - $y, ($r.bottom - $r.top) + $Pad * 2)
$bmp = New-Object System.Drawing.Bitmap $cw, $ch
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $cw, $ch))
if (-not $Out) { $Out = Join-Path (Get-Location) 'testjs\tmp\widget-shot.png' }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $Out ($cw x $ch)"

# put it back: insert below the first VISIBLE window above Progman
$above = [WS2]::GetWindow($shell, 3)
for ($i = 0; $i -lt 64 -and $above -ne [IntPtr]::Zero -and -not [WS2]::IsWindowVisible($above); $i++) {
  $up = [WS2]::GetWindow($above, 3)
  if ($up -eq [IntPtr]::Zero) { break }
  $above = $up
}
[void][WS2]::SetWindowPos($w, $above, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010)
Write-Output "z-order restored (below=$above)"
