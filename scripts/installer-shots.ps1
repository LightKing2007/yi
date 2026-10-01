# 在 Windows 上实际运行一遍安装程序，把每一页截下来（检查安装程序的图片与文字），CI 里用，见 .github/workflows/ui-shots.yml：
#   pwsh scripts/installer-shots.ps1 安装程序.exe 输出目录      （用 PowerShell 7，脚本里的中文才不会乱码）
# 依次截欢迎页、安装方式、安装位置、正在安装、完成页，每页按回车进入下一页；完成页再按回车会打开游戏，截一张看任务栏图标，然后关掉。
param([string]$Setup, [string]$Out = 'ui-shots')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$shell = New-Object -ComObject WScript.Shell

function Shot([string]$name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $Out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "截图 $name"
}
function Next([string]$name, [int]$wait = 3) {
  $shell.AppActivate($proc.Id) | Out-Null
  Start-Sleep -Milliseconds 300
  $shell.SendKeys('{ENTER}')
  Start-Sleep -Seconds $wait
  Shot $name
}

$proc = Start-Process -FilePath $Setup -PassThru
Start-Sleep -Seconds 8
$shell.AppActivate($proc.Id) | Out-Null
Shot 'setup-1-welcome'
Next 'setup-2-mode'
Next 'setup-3-folder'
Next 'setup-4-installing' 5
Start-Sleep -Seconds 60                                  # 等装完，停在完成页
Shot 'setup-5-finish'
Next 'setup-6-app' 20
Get-Process | Where-Object { $_.Path -like '*\Programs\yi\*' } | Stop-Process -Force -ErrorAction SilentlyContinue
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
