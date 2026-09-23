param(
  [string]$DashboardUrl = $(if ($env:NOWPLAYING_DASHBOARD_URL) { $env:NOWPLAYING_DASHBOARD_URL } else { 'http://127.0.0.1:47832/' }),
  [switch]$CanRunSetup,
  [switch]$SelfTest
)

# Exit codes tell `nowplaying.exe start` what the user picked:
#   0 = Quit NowPlaying, 3 = Run setup again.
$ExitQuit = 0
$ExitSetup = 3

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# The bundle keeps this script in app\scripts and the icons in <bundle>\assets;
# the repo keeps both next to each other.
$iconPath = @(
  (Join-Path $PSScriptRoot '..\..\assets\nowplaying.ico'),
  (Join-Path $PSScriptRoot '..\assets\nowplaying.ico')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $iconPath) { throw 'nowplaying.ico not found' }

$script:ExitCode = $ExitQuit
$notify = [System.Windows.Forms.NotifyIcon]::new()
$notify.Text = 'NowPlaying'
$notify.Icon = [System.Drawing.Icon]::new((Resolve-Path -LiteralPath $iconPath))
$notify.Visible = -not $SelfTest

$menu = [System.Windows.Forms.ContextMenuStrip]::new()
# Health line (#121): the app's /api/tray gives a short, private summary.
$statusItem = $menu.Items.Add('NowPlaying: starting...')
$statusItem.Enabled = $false
$menu.Items.Add('-') | Out-Null
$open = $menu.Items.Add('Open dashboard')
$open.add_Click({ Start-Process $DashboardUrl })
if ($CanRunSetup) {
  $setup = $menu.Items.Add('Run setup again')
  $setup.add_Click({ $script:ExitCode = $ExitSetup; $notify.Visible = $false; [System.Windows.Forms.Application]::Exit() })
}
$logs = $menu.Items.Add('Open log folder')
$logs.add_Click({
  if (-not $env:LOCALAPPDATA) { return }
  $logFolder = Join-Path $env:LOCALAPPDATA 'nowplaying\logs'
  New-Item -ItemType Directory -Force -Path $logFolder | Out-Null
  Start-Process -FilePath 'explorer.exe' -ArgumentList @("`"$logFolder`"")
})
$menu.Items.Add('-') | Out-Null
$exit = $menu.Items.Add('Quit NowPlaying')
$exit.add_Click({ $script:ExitCode = $ExitQuit; $notify.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ Start-Process $DashboardUrl })

if ($SelfTest) {
  # Builds the real menu without showing it, then reports what it contains.
  $items = @($menu.Items | ForEach-Object { $_.Text })
  [Console]::Out.Write((@{ ok = $true; icon = [string](Resolve-Path -LiteralPath $iconPath); items = $items } | ConvertTo-Json -Compress))
  $notify.Dispose(); $menu.Dispose()
  exit 0
}

$trayUrl = $DashboardUrl.TrimEnd('/') + '/api/tray'
function Update-TrayHealth {
  $line = 'NowPlaying: not responding'
  try {
    $health = Invoke-RestMethod -Uri $trayUrl -TimeoutSec 2 -UseBasicParsing
    if ($health.text -is [string] -and $health.text.Length -gt 0) { $line = $health.text }
  } catch { }
  if ($line.Length -gt 63) { $line = $line.Substring(0, 63) }
  $statusItem.Text = $line
  $notify.Text = $line
}
$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 15000
$timer.add_Tick({ Update-TrayHealth })
$timer.Start()
Update-TrayHealth

try { [System.Windows.Forms.Application]::Run() }
finally { $timer.Stop(); $timer.Dispose(); $notify.Visible = $false; $notify.Dispose(); $menu.Dispose() }
exit $script:ExitCode
