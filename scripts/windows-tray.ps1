param(
  [string]$DashboardUrl = $(if ($env:NOWPLAYING_DASHBOARD_URL) { $env:NOWPLAYING_DASHBOARD_URL } else { 'http://127.0.0.1:3000/' }),
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

try { [System.Windows.Forms.Application]::Run() }
finally { $notify.Visible = $false; $notify.Dispose(); $menu.Dispose() }
exit $script:ExitCode
