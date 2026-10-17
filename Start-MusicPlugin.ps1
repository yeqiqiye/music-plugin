# 点歌台插件：启动器（含自检）
#
# 用法（三种都行）：
#   .\Start-MusicPlugin.ps1              检查一遍并告诉我怎么打开
#   .\Start-MusicPlugin.ps1 -Open       检查完直接在默认浏览器里打开 DSH
#   .\Start-MusicPlugin.ps1 -Restart    重启 3080 的 DSH 服务（新插件/新代码后必须）
#
# 它只做三件事：查服务在不在、查插件装没装、把入口/自检页给你。
param(
    [switch]$Open,
    [switch]$Restart,
    [int]$Port = 3080
)

$ErrorActionPreference = 'Continue'
function Line($t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Cyan }

Line '1. DSH 服务'
$listening = $false
try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
        Write-Host "   3080 在监听：PID $($proc.ProcessId)，启动于 $($proc.CreationDate)" -ForegroundColor Green
        $listening = $true
    }
} catch {
    Write-Host "   3080 没有在监听。" -ForegroundColor Yellow
}

if ($Restart) {
    Line '重启 3080'
    $launcher = Join-Path $PSScriptRoot 'Start-DSH.ps1'
    if (-not (Test-Path $launcher)) { Write-Host "   找不到 $launcher" -ForegroundColor Red; exit 1 }
    & (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $launcher -Port $Port -NoOpen
    Start-Sleep -Seconds 2
    $listening = $true
}

Line '2. 插件是否装进 web profile'
$profilePkg = Join-Path $env:USERPROFILE '.dsh\profiles\web\package.json'
$pluginDir = Join-Path $env:USERPROFILE '.dsh\profiles\web\node_modules\dsh-music-request'
if (Test-Path $profilePkg) {
    $pkg = [System.IO.File]::ReadAllText($profilePkg, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $dep = $pkg.dependencies.'dsh-music-request'
    $inBundles = $pkg.dsh.profile.bundles -contains 'dsh-music-request'
    if ($dep) { Write-Host "   package.json 依赖：$dep" -ForegroundColor Green } else { Write-Host '   package.json 里没有 dsh-music-request！' -ForegroundColor Red }
    if ($inBundles) { Write-Host '   bundles 里已登记' -ForegroundColor Green } else { Write-Host '   bundles 里没登记（插件不会加载）！' -ForegroundColor Red }
} else {
    Write-Host "   找不到 $profilePkg" -ForegroundColor Red
}
if (Test-Path $pluginDir) {
    $hasPlay = Test-Path (Join-Path $pluginDir 'lib\playurl.mjs')
    Write-Host "   插件文件已就位（直接播放模块：$(if ($hasPlay) { '有' } else { '缺失' })）" -ForegroundColor Green
} else {
    Write-Host '   插件目录不存在，需要重新安装！' -ForegroundColor Red
}

Line '3. 怎么打开'
Write-Host '   · 在浏览器里打开 DSH（http://127.0.0.1:3080/），然后按 Alt+T'
Write-Host '   · 或者双击桌面上的 "DSH Web" 快捷方式'
if ($listening) {
    try {
        $again = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/" -TimeoutSec 5
        Write-Host "   · 服务返回 HTTP $($again.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "   · 服务返回：$($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host '     （401 是正常的：说明服务活着，只是需要带 token/cookie 访问）' -ForegroundColor DarkGray
    }
}

if ($Open -and $listening) {
    Start-Process "http://127.0.0.1:$Port/"
    Write-Host '   已在默认浏览器打开。' -ForegroundColor Green
}

Write-Host ''
Write-Host '提醒：改了插件代码（client/*.js 或 lib/*.mjs）之后，需要 -Restart 重启服务，' -ForegroundColor DarkGray
Write-Host '      然后在浏览器里 Ctrl+Shift+R 硬刷新；只改 UI 的话硬刷新即可。' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Press any key to close ...'
try { [void]$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { }
