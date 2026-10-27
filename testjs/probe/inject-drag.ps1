# Inject a real left-button drag at virtualized screen coords (DPI-unaware: physical = coord*1.25)
# ASCII only.
param(
  [int]$X = 1360,
  [int]$Y = 64,
  [int]$DX = 60,
  [int]$DY = 20,
  [int]$Steps = 20
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Inj {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT p);
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int x, y; }
}
'@

$LD = 0x0002
$LU = 0x0004

$p = New-Object Inj+PT
[void][Inj]::GetCursorPos([ref]$p)
Write-Output "startCursor=$($p.x),$($p.y)"
[void][Inj]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 150
[void][Inj]::GetCursorPos([ref]$p)
Write-Output "cursorNow=$($p.x),$($p.y)"
[Inj]::mouse_event($LD, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "down"
for ($i = 1; $i -le $Steps; $i++) {
  [void][Inj]::SetCursorPos($X + [int]($DX * $i / $Steps), $Y + [int]($DY * $i / $Steps))
  Start-Sleep -Milliseconds 15
}
[Inj]::mouse_event($LU, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "up"
[void][Inj]::GetCursorPos([ref]$p)
Write-Output "endCursor=$($p.x),$($p.y)"
