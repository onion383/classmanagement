<#
Git 代码统计（原始行 / 有效代码行 / 字符数）
功能：
1. git ls-files 读取文件列表（自动遵循 .gitignore）
2. 逐个统计每个文件：原始行数、代码行（已排除注释与空行）、字符数
3. 文件明细按代码行降序
4. 汇总维度：按后缀、按目录/模块
5. 报告导出为 Markdown：doc/仓库代码数量统计.md
6. 仅统计纯手写代码（源码/样式/标记/脚本/配置 白名单；锁文件、文档、资源等一律排除）

说明：不依赖 ThreadJob 等第三方模块，兼容 Windows PowerShell 5.1 与 PowerShell 7+。
#>
param(
    # 非交互调用（CI、管道、Agent）时传 -NoPause，避免末尾 Read-Host 挂住
    [switch]$NoPause
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

# 脚本位于 testjs/tools/，仓库根在上三级（原先放在仓库根，只需一级）
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
Set-Location -LiteralPath $root

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Git 代码统计（原始行 / 代码行 / 字符数）" -ForegroundColor Cyan
Write-Host "自动遵循 .gitignore；报告导出为 Markdown" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# ---- 取 git 跟踪文件 ----
$fileList = @()
try {
    # core.quotepath=false：避免中文文件名被转义成带引号的八进制串，导致 Path.GetFileName 抛「非法字符」
    $fileList = @(git -c core.quotepath=false ls-files 2>$null)
} catch {
    $fileList = @()
}
if ($fileList.Count -eq 0) {
    Write-Host "❌ 当前目录不是 git 仓库，或没有被 git 跟踪的文件" -ForegroundColor Red
    try { Read-Host "`n按回车退出" } catch { }
    exit
}

# ---- 仅统计纯手写代码：按后缀白名单（源码 / 样式 / 标记 / 脚本 / 配置）----
# 白名单之外的（文档 md/txt、图片/字体/压缩包/二进制等）一律排除；锁文件另按文件名排除
$codeExt = @(
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue',
    '.css', '.scss', '.sass', '.less',
    '.html', '.htm',
    '.json', '.iss',
    '.sh', '.bash', '.ps1', '.bat', '.cmd',
    '.py', '.rb', '.go', '.rs', '.java', '.cs', '.c', '.cpp', '.h', '.hpp',
    '.php', '.kt', '.swift', '.sql'
)

# 生成物按文件名排除（即使后缀在白名单里也不统计），例如锁文件
$excludeNames = @('package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml')

$sourceFiles = @()
$skippedCount = 0
foreach ($f in $fileList) {
    $name = [System.IO.Path]::GetFileName($f).ToLower()
    if ($excludeNames -contains $name) { $skippedCount++; continue }
    if ($codeExt -contains [System.IO.Path]::GetExtension($f).ToLower()) {
        $sourceFiles += $f
    } else {
        $skippedCount++
    }
}

# 行注释前缀（按后缀）——统计“代码行”时用于剔除整行注释
function Get-LineCommentPrefixes {
    param([string]$Ext)
    switch ($Ext) {
        { $_ -in '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue',
                  '.css', '.scss', '.sass', '.less',
                  '.java', '.cs', '.c', '.cpp', '.h', '.hpp',
                  '.php', '.go', '.rs', '.kt', '.swift' } { return @('//') }
        { $_ -in '.sh', '.bash', '.ps1', '.py', '.rb' } { return @('#') }
        '.iss'  { return @(';') }
        '.sql'  { return @('--') }
        default { return @() }
    }
}

# ---- 单个文件统计 ----
function Measure-OneFile {
    param([string]$RelPath)

    $full = Join-Path $root $RelPath
    $text = ''
    try {
        # ReadAllText 自动识别 BOM，无 BOM 时按 UTF-8 解码；二进制也不会抛异常
        $text = [System.IO.File]::ReadAllText($full)
    } catch {
        # 无法读取（权限/占用/已删除）按空文件处理，避免整个脚本中断
        $text = ''
    }

    # 后缀（无后缀归为“无后缀”）
    $ext = [System.IO.Path]::GetExtension($RelPath)
    if ([string]::IsNullOrEmpty($ext)) { $ext = '无后缀' }

    # 原始行数：换行符个数；结尾有换行则末行不计为空行
    if ($text.Length -eq 0) {
        $rawLines = 0
    } else {
        $rawLines = ($text -split "`n").Count
        if ($text.EndsWith("`n")) { $rawLines-- }
    }

    # 代码行：先剥离块注释（/* */ 与 <!-- -->），再去掉整行注释与空行
    $prefixes = Get-LineCommentPrefixes -Ext $ext
    $stripped = $text -replace '(?s)/\*.*?\*/', '' -replace '(?s)<!--.*?-->', ''
    $codeLines = 0
    foreach ($ln in ($stripped -split "`n")) {
        $t = $ln.Trim()
        if ($t -eq '') { continue }
        $isComment = $false
        foreach ($p in $prefixes) {
            if ($t.StartsWith($p)) { $isComment = $true; break }
        }
        if (-not $isComment) { $codeLines++ }
    }

    # 模块：取路径第一段（顶层目录）；根目录下的文件归为“(根目录)”
    # testjs 作为一个整体模块统计，不再按 units/smoke/probe/tools 细分
    $norm = $RelPath -replace '\\', '/'
    $slash = $norm.IndexOf('/')
    $module = if ($slash -lt 0) { '(根目录)' } else { $norm.Substring(0, $slash) }

    [PSCustomObject]@{
        FilePath = $RelPath
        Module   = $module
        Ext      = $ext
        Lines    = $rawLines
        Code     = $codeLines
        Chars    = $text.Length
    }
}

Write-Host "⏳ 正在统计 $($sourceFiles.Count) 个源码文件（已排除 $skippedCount 个非源码文件）..."
$allResult = @()
foreach ($f in $sourceFiles) {
    $allResult += Measure-OneFile -RelPath $f
}

$sorted = @($allResult | Sort-Object -Property Code -Descending)

# ---- 汇总（按指定字段分组小计）----
function Group-Summary {
    param($Items, [string]$KeyName)
    $Items | Group-Object -Property $KeyName | ForEach-Object {
        [PSCustomObject]@{
            Key   = $_.Name
            Count = $_.Count
            Lines = ($_.Group | Measure-Object -Property Lines -Sum).Sum
            Code  = ($_.Group | Measure-Object -Property Code  -Sum).Sum
            Chars = ($_.Group | Measure-Object -Property Chars -Sum).Sum
        }
    } | Sort-Object -Property Code -Descending
}

$byExt    = @(Group-Summary -Items $allResult -KeyName 'Ext')
$byModule = @(Group-Summary -Items $allResult -KeyName 'Module')

$totalFiles = $allResult.Count
$totalLines = ($allResult | Measure-Object -Property Lines -Sum).Sum
$totalCode  = ($allResult | Measure-Object -Property Code  -Sum).Sum
$totalChars = ($allResult | Measure-Object -Property Chars -Sum).Sum

# ---- 控制台输出：文件明细 ----
Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "文件列表【按代码行从大到小排序】"
Write-Host "代码行`t原始行`t字符数`t后缀`t文件路径"
Write-Host "======================================" -ForegroundColor Cyan
foreach ($item in $sorted) {
    Write-Host "$($item.Code)`t$($item.Lines)`t$($item.Chars)`t$($item.Ext)`t$($item.FilePath)"
}

# ---- 控制台输出：按后缀汇总 ----
Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "【按后缀汇总统计】"
Write-Host "后缀`t文件数`t代码行`t原始行`t字符数"
Write-Host "======================================" -ForegroundColor Cyan
foreach ($g in $byExt) {
    Write-Host "$($g.Key)`t$($g.Count)`t$($g.Code)`t$($g.Lines)`t$($g.Chars)"
}

# ---- 控制台输出：按目录/模块汇总 ----
Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "【按目录/模块汇总统计】"
Write-Host "模块`t文件数`t代码行`t原始行`t字符数"
Write-Host "======================================" -ForegroundColor Cyan
foreach ($g in $byModule) {
    Write-Host "$($g.Key)`t$($g.Count)`t$($g.Code)`t$($g.Lines)`t$($g.Chars)"
}

# ---- 控制台输出：全局汇总 ----
Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "全局汇总"
Write-Host "文件总数：$totalFiles"
Write-Host "代码总行数（已排除注释与空行）：$totalCode"
Write-Host "原始总行数：$totalLines"
Write-Host "全部文件总字符数：$totalChars"
Write-Host "已排除非源码文件：$skippedCount"
Write-Host "======================================" -ForegroundColor Cyan

# ---- 导出 Markdown 报告 ----
$md = New-Object System.Collections.Generic.List[string]
$md.Add('# 代码统计报告')
$md.Add('')
$md.Add("> 生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')　文件总数：$totalFiles　代码行：$totalCode　原始行：$totalLines　字符数：$totalChars")
$md.Add('')

$md.Add('## 全局汇总')
$md.Add('')
$md.Add('| 指标 | 数值 |')
$md.Add('| --- | ---: |')
$md.Add("| 文件总数 | $totalFiles |")
$md.Add("| 代码总行数（排除注释与空行） | $totalCode |")
$md.Add("| 原始总行数 | $totalLines |")
$md.Add("| 总字符数 | $totalChars |")
$md.Add("| 已排除非源码文件 | $skippedCount |")
$md.Add('')

$md.Add('## 按目录/模块汇总')
$md.Add('')
$md.Add('| 模块 | 文件数 | 代码行 | 原始行 | 字符数 |')
$md.Add('| --- | ---: | ---: | ---: | ---: |')
foreach ($g in $byModule) {
    $md.Add("| $($g.Key) | $($g.Count) | $($g.Code) | $($g.Lines) | $($g.Chars) |")
}
$md.Add('')

$md.Add('## 按后缀汇总')
$md.Add('')
$md.Add('| 后缀 | 文件数 | 代码行 | 原始行 | 字符数 |')
$md.Add('| --- | ---: | ---: | ---: | ---: |')
foreach ($g in $byExt) {
    $md.Add("| $($g.Key) | $($g.Count) | $($g.Code) | $($g.Lines) | $($g.Chars) |")
}
$md.Add('')

$md.Add('## 文件明细（按代码行降序）')
$md.Add('')
$md.Add('| 代码行 | 原始行 | 字符数 | 后缀 | 模块 | 文件路径 |')
$md.Add('| ---: | ---: | ---: | --- | --- | --- |')
foreach ($item in $sorted) {
    $md.Add("| $($item.Code) | $($item.Lines) | $($item.Chars) | $($item.Ext) | $($item.Module) | $($item.FilePath) |")
}
$md.Add('')

$reportPath = 'doc\仓库代码数量统计.md'
($md -join "`r`n") | Out-File -Encoding utf8 $reportPath
Write-Host "`n✅ 报告已保存到：$reportPath"

# 仅在交互式终端等待回车；被管道/自动化调用时直接结束（避免 NonInteractive 报错）
if (-not $NoPause) {
    try { Read-Host "`n统计完成，按回车退出" } catch { }
}
