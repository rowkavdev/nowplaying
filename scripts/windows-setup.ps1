# Native first-run setup window for nowplaying. All state lives in the local
# setup server (/api/setup/draft); this window only renders it, so progress is
# shared with the browser fallback and survives closing the window.
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine("windows-setup.ps1 line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"); exit 1 }
if ($Url -notmatch '^http://127\.0\.0\.1:([0-9]{1,5})/setup$') { throw 'Setup URL must be a loopback /setup URL.' }
$Base = $Url.Substring(0, $Url.Length - '/setup'.Length)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Steps = @('welcome', 'provider', 'discord', 'review', 'complete')
$StepLabels = @{ welcome = 'Welcome'; provider = 'Media server'; discord = 'Discord'; review = 'Review'; complete = 'Done' }
$Providers = [ordered]@{ plex = 'Plex'; jellyfin = 'Jellyfin'; emby = 'Emby'; navidrome = 'Navidrome' }
$Idle = [ordered]@{ clear = 'Clear my status'; grace = 'Keep it for a short grace period'; show = 'Show that nothing is playing'; recent = 'Show what I played last' }

function Invoke-Setup([string]$Method, [string]$Path, $Body = $null) {
  $params = @{ Method = $Method; Uri = "$Base$Path"; TimeoutSec = 10; UseBasicParsing = $true; Headers = @{ Accept = 'application/json' } }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress -Depth 4))
  }
  Invoke-RestMethod @params
}

function Get-Discovered {
  try { return @((Invoke-Setup 'GET' '/api/setup/discover').servers) } catch { return @() }
}

$script:Draft = (Invoke-Setup 'GET' '/api/setup/draft').draft
$script:Discovered = Get-Discovered

$form = [System.Windows.Forms.Form]::new()
$form.Text = 'NowPlaying setup'
$form.ClientSize = [System.Drawing.Size]::new(560, 400)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.Font = [System.Drawing.Font]::new('Segoe UI', 10)
$iconPath = Join-Path $PSScriptRoot '..\assets\nowplaying.ico'
if (Test-Path $iconPath) { $form.Icon = [System.Drawing.Icon]::new((Resolve-Path $iconPath)) }

$stepsLabel = [System.Windows.Forms.Label]::new()
$stepsLabel.SetBounds(24, 16, 512, 24)
$stepsLabel.ForeColor = [System.Drawing.Color]::DimGray
$title = [System.Windows.Forms.Label]::new()
$title.SetBounds(24, 44, 512, 32)
$title.Font = [System.Drawing.Font]::new('Segoe UI Semibold', 14)
$panel = [System.Windows.Forms.FlowLayoutPanel]::new()
$panel.SetBounds(24, 84, 512, 230)
$panel.FlowDirection = 'TopDown'
$panel.WrapContents = $false
$panel.AutoScroll = $true
$errorLabel = [System.Windows.Forms.Label]::new()
$errorLabel.SetBounds(24, 318, 512, 24)
$errorLabel.ForeColor = [System.Drawing.Color]::Firebrick
$back = [System.Windows.Forms.Button]::new(); $back.Text = 'Back'; $back.SetBounds(24, 350, 90, 32)
$next = [System.Windows.Forms.Button]::new(); $next.Text = 'Next'; $next.SetBounds(122, 350, 90, 32)
$reset = [System.Windows.Forms.LinkLabel]::new(); $reset.Text = 'Start over'; $reset.SetBounds(446, 358, 90, 24); $reset.TextAlign = 'MiddleRight'
$form.Controls.AddRange(@($stepsLabel, $title, $panel, $errorLabel, $back, $next, $reset))
$form.AcceptButton = $next

function New-Text([string]$Text) {
  $label = [System.Windows.Forms.Label]::new()
  $label.Text = $Text; $label.AutoSize = $true; $label.MaximumSize = [System.Drawing.Size]::new(490, 0); $label.Margin = [System.Windows.Forms.Padding]::new(0, 0, 0, 10)
  $label
}

function Get-Changes {
  $changes = @{}
  foreach ($control in $panel.Controls) {
    if ($control -is [System.Windows.Forms.RadioButton] -and $control.Checked) { $changes.provider = [string]$control.Tag }
    if ($control.Name -eq 'discordEnabled') { $changes.discordEnabled = [bool]$control.Checked }
    if ($control.Name -eq 'discordIdleBehavior' -and $control.SelectedItem) { $changes.discordIdleBehavior = [string]$control.SelectedItem.Key }
  }
  $changes
}

function Update-Buttons {
  $index = [array]::IndexOf($Steps, $script:Draft.step)
  $back.Enabled = $index -gt 0 -and $index -lt ($Steps.Count - 1)
  $picked = @($panel.Controls | Where-Object { $_ -is [System.Windows.Forms.RadioButton] -and $_.Checked }).Count -gt 0
  $next.Enabled = ($script:Draft.step -ne 'provider') -or $picked
  $next.Text = switch ($script:Draft.step) { 'review' { 'Finish' } 'complete' { 'Close' } default { 'Next' } }
}

function Show-Step {
  $panel.SuspendLayout()
  $panel.Controls.Clear()
  $stepsLabel.Text = ($Steps | ForEach-Object { if ($_ -eq $script:Draft.step) { "[$($StepLabels[$_])]" } else { $StepLabels[$_] } }) -join '   '
  switch ($script:Draft.step) {
    'welcome' {
      $title.Text = "Show what you're playing on Discord"
      $panel.Controls.Add((New-Text 'This takes about a minute. Your progress is saved on this PC, so you can close this window and come back.'))
    }
    'provider' {
      $title.Text = 'Which media server do you use?'
      $found = @($script:Discovered | Where-Object { $Providers.Contains([string]$_.provider) })
      $checkedOne = $false
      if ($found.Count -gt 0) { $panel.Controls.Add((New-Text 'Found on this PC:')) }
      foreach ($server in $found) {
        $radio = [System.Windows.Forms.RadioButton]::new()
        $version = if ($server.version) { " $($server.version)" } else { '' }
        $radio.Text = "$($Providers[[string]$server.provider])$version  ($($server.baseUrl -replace '^http://', ''))"
        $radio.Tag = [string]$server.provider; $radio.AutoSize = $true
        if (-not $checkedOne -and $script:Draft.provider -eq $radio.Tag) { $radio.Checked = $true; $checkedOne = $true }
        $radio.add_CheckedChanged({ Update-Buttons })
        $panel.Controls.Add($radio)
      }
      $panel.Controls.Add((New-Text $(if ($found.Count -gt 0) { 'Or choose another server:' } else { 'No server found running on this PC. Choose yours:' })))
      foreach ($key in $Providers.Keys) {
        $radio = [System.Windows.Forms.RadioButton]::new()
        $radio.Text = $Providers[$key]; $radio.Tag = $key; $radio.AutoSize = $true
        if (-not $checkedOne -and $script:Draft.provider -eq $key) { $radio.Checked = $true; $checkedOne = $true }
        $radio.add_CheckedChanged({ Update-Buttons })
        $panel.Controls.Add($radio)
      }
    }
    'discord' {
      $title.Text = 'Discord status'
      $enabled = [System.Windows.Forms.CheckBox]::new()
      $enabled.Name = 'discordEnabled'; $enabled.Text = "Show what I'm playing on Discord"; $enabled.AutoSize = $true; $enabled.Checked = [bool]$script:Draft.discordEnabled
      $panel.Controls.Add($enabled)
      $panel.Controls.Add((New-Text 'When nothing is playing:'))
      $idleBox = [System.Windows.Forms.ComboBox]::new()
      $idleBox.Name = 'discordIdleBehavior'; $idleBox.DropDownStyle = 'DropDownList'; $idleBox.Width = 320; $idleBox.DisplayMember = 'Value'
      foreach ($entry in $Idle.GetEnumerator()) { [void]$idleBox.Items.Add([pscustomobject]@{ Key = $entry.Key; Value = $entry.Value }) }
      $idleBox.SelectedIndex = [math]::Max(0, @($Idle.Keys).IndexOf([string]$script:Draft.discordIdleBehavior))
      $panel.Controls.Add($idleBox)
    }
    'review' {
      $title.Text = 'Check your choices'
      $provider = if ($script:Draft.provider) { $Providers[[string]$script:Draft.provider] } else { 'Not chosen' }
      $status = if ($script:Draft.discordEnabled) { 'On' } else { 'Off' }
      $panel.Controls.Add((New-Text "Media server: $provider"))
      $panel.Controls.Add((New-Text "Discord status: $status - when idle: $($Idle[[string]$script:Draft.discordIdleBehavior])"))
    }
    default {
      $title.Text = 'All set'
      $panel.Controls.Add((New-Text 'Your choices are saved. Next you will sign in to your media server.'))
    }
  }
  $panel.ResumeLayout()
  Update-Buttons
}

function Send-Step([string]$Method, $Body) {
  $errorLabel.Text = ''
  $form.UseWaitCursor = $true
  try { $script:Draft = (Invoke-Setup $Method '/api/setup/draft' $Body).draft }
  catch { $script:LastError = $_.Exception.Message; $errorLabel.Text = "Couldn't save that step. Check NowPlaying is still running and try again." }
  finally { $form.UseWaitCursor = $false }
  Show-Step
}

$onNext = { if ($script:Draft.step -eq 'complete') { $form.Close() } else { Send-Step 'POST' @{ action = 'next'; changes = (Get-Changes) } } }
$onBack = { Send-Step 'POST' @{ action = 'back'; changes = (Get-Changes) } }
$next.add_Click($onNext)
$back.add_Click($onBack)
$reset.add_LinkClicked({ Send-Step 'DELETE' $null })

Show-Step

if ($SelfTest) {
  # Drives every step through the real handlers without showing the window.
  $seen = @($script:Draft.step)
  & $onNext
  $radio = @($panel.Controls | Where-Object { $_ -is [System.Windows.Forms.RadioButton] })[0]
  if (-not $radio) { throw 'provider step rendered no choices' }
  $radio.Checked = $true
  $seen += $script:Draft.step
  & $onNext
  & $onBack
  $seen += $script:Draft.step
  foreach ($i in 1..3) { & $onNext; $seen += $script:Draft.step }
  if ($errorLabel.Text) { throw "self-test error: $($errorLabel.Text) ($script:LastError)" }
  [Console]::Out.Write((@{ ok = $true; steps = $seen; provider = $script:Draft.provider } | ConvertTo-Json -Compress))
  $form.Dispose()
  exit 0
}

[System.Windows.Forms.Application]::EnableVisualStyles()
[void]$form.ShowDialog()
$form.Dispose()
