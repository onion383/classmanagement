# Regression check for desktop widget "bottom mode" (top-level + z-order above Progman).
# Checks per drag: no crash event, size unchanged, window re-placed just above Progman.
# ASCII only (PS 5.1 reads scripts as ANSI).
param(
  [int]$Drags = 3,
  [int]$Dx = 40,
  [int]$Dy = 12
)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RG {
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
}
'@

function Get-Rect([IntPtr]$h) {
  $r = New-Object RG+RECT
  [void][RG]::GetWindowRect($h, [ref]$r)
  return $r
}
function Get-Cls([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 256
  [void][RG]::GetClassNameW($h, $sb, 256)
  return $sb.ToString()
}
function Find-Widget {
  $shell = [RG]::GetShellWindow()
  if ($shell -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
  $h = [RG]::GetWindow($shell, 3) # GW_HWNDPREV
  for ($i = 0; $i -lt 6 -and $h -ne [IntPtr]::Zero; $i++) {
    $r = Get-Rect $h
    $w = $r.right - $r.left
    $ht = $r.bottom - $r.top
    if ((Get-Cls $h) -eq 'Chrome_WidgetWin_1' -and $w -ge 300 -and $w -le 340 -and $ht -gt 600) { return $h }
    $h = [RG]::GetWindow($h, 3)
  }
  return [IntPtr]::Zero
}
function Is-AboveProgman([IntPtr]$h) {
  $shell = [RG]::GetShellWindow()
  return ([RG]::GetWindow($shell, 3) -eq $h)
}
function Crash-Count {
  return @(Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddMinutes(-5)} -ErrorAction SilentlyContinue |
    Where-Object { $_.ProviderName -eq 'Application Error' }).Count
}

$w = Find-Widget
if ($w -eq [IntPtr]::Zero) { Write-Output 'widget not found above Progman'; exit 2 }
$r0 = Get-Rect $w
Write-Output "widget hwnd=$w rect=$($r0.left),$($r0.top) $($r0.right - $r0.left)x$($r0.bottom - $r0.top) above=$((Is-AboveProgman $w))"

$fail = 0
for ($n = 1; $n -le $Drags; $n++) {
  $before = Crash-Count
  $r = Get-Rect $w
  # raise above normal windows so the synthetic click can reach it, then drag
  [void][RG]::SetWindowPos($w, [IntPtr]::Zero, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010)
  Start-Sleep -Milliseconds 250
  $x = $r.left + 160
  $y = $r.top + 50
  . "$PSScriptRoot\inject-drag.ps1" -X $x -Y $y -DX $Dx -DY $Dy -Steps 15 | Out-Null
  Start-Sleep -Seconds 2
  $after = Crash-Count
  $r2 = Get-Rect $w
  $sizeOk = (($r2.right - $r2.left) -eq ($r0.right - $r0.left)) -and (($r2.bottom - $r2.top) -eq ($r0.bottom - $r0.top))
  $back = Is-AboveProgman $w
  $crashed = $after -gt $before
  if ($crashed -or -not $sizeOk -or -not $back) { $fail++ }
  Write-Output ("drag#{0} moved={1},{2} sizeOk={3} backAboveProgman={4} crashed={5}" -f $n, $r2.left, $r2.top, $sizeOk, $back, $crashed)
}

Write-Output "failures=$fail"
if (Test-Path (Join-Path $env:APPDATA 'campus-assistant\desktop-widget-pos.json')) {
  Write-Output "posFile=$(Get-Content (Join-Path $env:APPDATA 'campus-assistant\desktop-widget-pos.json') -Raw)"
}
# 失败必须让外层脚本/CI 能判定（否则输出 failures=N 也永远算通过）
if ($fail -gt 0) { exit 1 }
exit 0
