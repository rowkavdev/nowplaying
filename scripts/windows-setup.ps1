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

$Steps = @('welcome', 'provider', 'signin', 'discord', 'review', 'complete')
$StepLabels = @{ welcome = 'Welcome'; provider = 'Media server'; signin = 'Sign in'; discord = 'Discord'; review = 'Review'; complete = 'Done' }
$DefaultUrls = @{ plex = 'http://127.0.0.1:32400'; jellyfin = 'http://127.0.0.1:8096'; emby = 'http://127.0.0.1:8096'; navidrome = 'http://127.0.0.1:4533' }
$SignInErrors = @{
  authentication_failed = "That username or password didn't work."
  invalid_server_url = 'Enter the server address, like http://127.0.0.1:8096.'
  unreachable = "Couldn't reach that server. Check the address and that the server is running."
  quick_connect_disabled = 'Quick Connect is turned off on this Jellyfin server. Turn it on in the Jellyfin dashboard and try again.'
  expired = 'That sign-in expired. Start again.'
  too_many_signins = 'Too many sign-ins are open. Wait a minute and try again.'
}
$script:SignIn = @{ FlowId = $null; Code = $null }
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

# Sign-in replies carry an error code in the body on 4xx/5xx; Invoke-RestMethod
# throws on those, so read the body back out of the exception.
function Invoke-SignIn($Body) {
  try { return Invoke-Setup 'POST' '/api/setup/signin' $Body }
  catch {
    $code = $null
    try { $code = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { }
    if (-not $code) {
      try {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $code = ($reader.ReadToEnd() | ConvertFrom-Json).error
      } catch { }
    }
    $message = if ($code -and $SignInErrors.ContainsKey([string]$code)) { $SignInErrors[[string]$code] } else { "Sign-in didn't work. Check the details and try again." }
    throw [System.InvalidOperationException]::new($message)
  }
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
$pollTimer = [System.Windows.Forms.Timer]::new()
$pollTimer.Interval = 2000

function New-Text([string]$Text) {
  $label = [System.Windows.Forms.Label]::new()
  $label.Text = $Text; $label.AutoSize = $true; $label.MaximumSize = [System.Drawing.Size]::new(490, 0); $label.Margin = [System.Windows.Forms.Padding]::new(0, 0, 0, 10)
  $label
}

function New-Field([string]$Name, [string]$Label, [string]$Value, [bool]$Secret = $false) {
  $panel.Controls.Add((New-Text $Label))
  $box = [System.Windows.Forms.TextBox]::new()
  $box.Name = $Name; $box.Width = 360; $box.Text = $Value; $box.UseSystemPasswordChar = $Secret
  $box.Margin = [System.Windows.Forms.Padding]::new(0, 0, 0, 8)
  $panel.Controls.Add($box)
  $box
}

function Get-Field([string]$Name) {
  $control = @($panel.Controls | Where-Object { $_.Name -eq $Name })[0]
  if ($control) { return $control.Text.Trim() } else { return '' }
}

function Stop-SignIn {
  $pollTimer.Stop()
  $script:SignIn = @{ FlowId = $null; Code = $null }
}

function Complete-SignIn($Result) {
  if ($Result.status -eq 'signed_in') {
    Stop-SignIn
    $script:Draft = (Invoke-Setup 'GET' '/api/setup/draft').draft
  } elseif ($Result.status -eq 'pending' -and $script:SignIn.FlowId) {
    $pollTimer.Start()
  }
}

function Start-SignIn($Body) {
  $errorLabel.Text = ''
  Stop-SignIn
  $form.UseWaitCursor = $true
  try {
    $result = Invoke-SignIn $Body
    if ($result.status -eq 'pending') {
      $script:SignIn = @{ FlowId = [string]$result.flowId; Code = $result.code }
      if ($result.authUrl -and ([string]$result.authUrl).StartsWith('https://app.plex.tv/') -and -not $SelfTest) { Start-Process ([string]$result.authUrl) }
    }
    Complete-SignIn $result
  } catch {
    $script:LastError = $_.Exception.Message
    $errorLabel.Text = $_.Exception.Message
  } finally { $form.UseWaitCursor = $false }
  Show-Step
}

$onSignIn = {
  switch ([string]$script:Draft.provider) {
    'plex' { Start-SignIn @{ action = 'start'; provider = 'plex'; baseUrl = (Get-Field 'serverUrl') } }
    'jellyfin' { Start-SignIn @{ action = 'start'; provider = 'jellyfin'; baseUrl = (Get-Field 'serverUrl') } }
    default {
      $passwordBox = @($panel.Controls | Where-Object { $_.Name -eq 'password' })[0]
      $password = if ($passwordBox) { $passwordBox.Text } else { '' }
      if ($passwordBox) { $passwordBox.Text = '' }
      Start-SignIn @{ action = 'password'; provider = [string]$script:Draft.provider; baseUrl = (Get-Field 'serverUrl'); username = (Get-Field 'username'); password = $password }
    }
  }
}

$pollTimer.add_Tick({
  $pollTimer.Stop()
  if (-not $script:SignIn.FlowId) { return }
  try { Complete-SignIn (Invoke-SignIn @{ action = 'poll'; flowId = $script:SignIn.FlowId }) }
  catch { Stop-SignIn; $script:LastError = $_.Exception.Message; $errorLabel.Text = $_.Exception.Message }
  if (-not $script:SignIn.FlowId) { Show-Step }
})

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
  $next.Enabled = (($script:Draft.step -ne 'provider') -or $picked) -and (($script:Draft.step -ne 'signin') -or [bool]$script:Draft.account)
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
    'signin' {
      $name = $Providers[[string]$script:Draft.provider]
      $title.Text = "Sign in to $name"
      if ($script:Draft.account) { $panel.Controls.Add((New-Text "Signed in as $($script:Draft.account.displayName). Your sign-in is saved in Windows Credential Manager.")) }
      $found = @($script:Discovered | Where-Object { [string]$_.provider -eq [string]$script:Draft.provider })[0]
      $serverUrl = if ($found) { [string]$found.baseUrl } else { $DefaultUrls[[string]$script:Draft.provider] }
      $button = [System.Windows.Forms.Button]::new()
      $button.Name = 'signinStart'; $button.AutoSize = $true
      switch ([string]$script:Draft.provider) {
        'plex' {
          [void](New-Field 'serverUrl' 'Plex server address' $serverUrl)
          $panel.Controls.Add((New-Text $(if ($script:SignIn.FlowId) { "Finish signing in on the Plex page in your browser. This window updates when you're done." } else { 'Plex opens in your browser so you can approve NowPlaying.' })))
          $button.Text = if ($script:Draft.account) { 'Sign in again' } else { 'Open Plex sign-in' }
        }
        'jellyfin' {
          [void](New-Field 'serverUrl' 'Server address' $serverUrl)
          if ($script:SignIn.Code) {
            $panel.Controls.Add((New-Text 'In Jellyfin, open Quick Connect and enter this code:'))
            $codeLabel = New-Text ([string]$script:SignIn.Code)
            $codeLabel.Name = 'quickConnectCode'; $codeLabel.Font = [System.Drawing.Font]::new('Consolas', 18, [System.Drawing.FontStyle]::Bold)
            $panel.Controls.Add($codeLabel)
          }
          $button.Text = if ($script:SignIn.Code) { 'Get a new code' } else { 'Get a Quick Connect code' }
        }
        default {
          [void](New-Field 'serverUrl' 'Server address' $serverUrl)
          [void](New-Field 'username' 'Username' '')
          [void](New-Field 'password' 'Password (sent only to your server, never saved)' '' $true)
          $button.Text = 'Sign in'
        }
      }
      $button.add_Click($onSignIn)
      $panel.Controls.Add($button)
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
      $who = if ($script:Draft.account) { " (signed in as $($script:Draft.account.displayName))" } else { '' }
      $panel.Controls.Add((New-Text "Media server: $provider$who"))
      $panel.Controls.Add((New-Text "Discord status: $status - when idle: $($Idle[[string]$script:Draft.discordIdleBehavior])"))
    }
    default {
      $title.Text = 'All set'
      $done = if ($script:Draft.account) { "You're signed in to $($Providers[[string]$script:Draft.provider]) as $($script:Draft.account.displayName), and your choices are saved." } else { 'Your choices are saved.' }
      $panel.Controls.Add((New-Text $done))
    }
  }
  $panel.ResumeLayout()
  Update-Buttons
}

function Send-Step([string]$Method, $Body) {
  $errorLabel.Text = ''
  Stop-SignIn
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
  $seen += $script:Draft.step
  if ($next.Enabled) { throw 'Next must wait for sign-in' }
  $password = @($panel.Controls | Where-Object { $_.Name -eq 'password' })[0]
  if (-not $password -or -not $password.UseSystemPasswordChar) { throw 'sign-in step needs a masked password box' }
  if ((Get-Field 'serverUrl') -ne [string]$script:Discovered[0].baseUrl) { throw 'server address was not prefilled from discovery' }
  @($panel.Controls | Where-Object { $_.Name -eq 'username' })[0].Text = 'selftest'
  $password.Text = 'selftest-password'
  # PerformClick is ignored on a hidden form, so call the button's handler.
  if (-not @($panel.Controls | Where-Object { $_.Name -eq 'signinStart' })[0]) { throw 'sign-in step has no sign-in button' }
  & $onSignIn
  if ($errorLabel.Text) { throw "self-test sign-in error: $($errorLabel.Text)" }
  if (-not $script:Draft.account -or -not $next.Enabled) { throw 'sign-in did not record the account' }
  & $onNext
  & $onBack
  $seen += $script:Draft.step
  foreach ($i in 1..3) { & $onNext; $seen += $script:Draft.step }
  if ($errorLabel.Text) { throw "self-test error: $($errorLabel.Text) ($script:LastError)" }
  [Console]::Out.Write((@{ ok = $true; steps = $seen; provider = $script:Draft.provider; account = $script:Draft.account.displayName } | ConvertTo-Json -Compress))
  $form.Dispose()
  exit 0
}

[System.Windows.Forms.Application]::EnableVisualStyles()
[void]$form.ShowDialog()
$form.Dispose()
