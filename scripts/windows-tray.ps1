param(
  [string]$DashboardUrl = $(if ($env:NOWPLAYING_DASHBOARD_URL) { $env:NOWPLAYING_DASHBOARD_URL } else { 'http://127.0.0.1:3000/' })
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$iconPath = Join-Path $PSScriptRoot '..\assets\nowplaying.ico'
$notify = [System.Windows.Forms.NotifyIcon]::new()
$notify.Text = 'nowplaying'
$notify.Icon = [System.Drawing.Icon]::new((Resolve-Path $iconPath))
$notify.Visible = $true

$menu = [System.Windows.Forms.ContextMenuStrip]::new()
$open = $menu.Items.Add('Open dashboard')
$open.add_Click({ Start-Process $DashboardUrl })
$menu.Items.Add('-') | Out-Null
$exit = $menu.Items.Add('Exit tray')
$exit.add_Click({ $notify.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ Start-Process $DashboardUrl })

try { [System.Windows.Forms.Application]::Run() }
finally { $notify.Visible = $false; $notify.Dispose(); $menu.Dispose() }
