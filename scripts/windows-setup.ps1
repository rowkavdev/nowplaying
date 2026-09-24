# Native first-run setup window for nowplaying. All state lives in the local
# setup server (/api/setup/draft); this window only renders it, so progress is
# shared with the browser fallback and survives closing the window.
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [switch]$SelfTest,
  [switch]$VisibilityProbe,
  [switch]$ProbeWithoutShowFix
)

$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine("windows-setup.ps1 line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"); exit 1 }
if ($Url -notmatch '^http://127\.0\.0\.1:([0-9]{1,5})/setup$') { throw 'Setup URL must be a loopback /setup URL.' }
$Base = $Url.Substring(0, $Url.Length - '/setup'.Length)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace NowPlaying -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
'@

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
$TestMessages = @{
  connected = "Connected. NowPlaying can see what you're playing."
  authentication_failed = 'Your server rejected the saved sign-in. Sign in again.'
  unreachable = "Couldn't reach your server. Check the address and that the server is running."
  connection_failed = "Your server answered, but not in a way NowPlaying understands. Check the address points at your media server."
  missing_server = 'Add your server address, then sign in again.'
  credential_unavailable = 'Your saved sign-in is missing from Windows Credential Manager. Sign in again.'
  invalid_configuration = 'The saved details look wrong. Sign in again.'
  not_signed_in = 'Sign in first, then test the connection.'
  too_many_tests = 'Too many tests in a row. Wait a few seconds and try again.'
  user_mismatch = 'Your server says this sign-in belongs to a different user. Sign in again with the account you play on.'
}
$SpotifyErrors = @{
  bad_client_id = "That doesn't look like a Spotify Client ID. It's the 32-character ID on your app's page in the Spotify developer dashboard."
  denied = "Spotify access wasn't allowed. Try again and choose Agree."
  expired = 'That Spotify sign-in expired. Start again.'
  too_many_signins = 'Too many sign-ins are open. Wait a minute and try again.'
}
$script:Spotify = @{ FlowId = $null; ClientId = '' }
$DraftErrors = @{
  too_many_servers = 'You can add up to 8 servers.'
  server_not_found = 'That server was already removed.'
}
$script:TestResult = $null
$script:SignIn = @{ FlowId = $null; Code = $null }
$Providers = [ordered]@{ plex = 'Plex'; jellyfin = 'Jellyfin'; emby = 'Emby'; navidrome = 'Navidrome' }
$Idle = [ordered]@{ clear = 'Clear my status'; grace = 'Keep it for a short grace period'; show = 'Show that nothing is playing'; recent = 'Show what I played last' }

# The setup server only accepts changes that carry this run's session secret.
$script:SessionSecret = $env:NOWPLAYING_SETUP_SESSION
Remove-Item Env:NOWPLAYING_SETUP_SESSION -ErrorAction SilentlyContinue

function Invoke-Setup([string]$Method, [string]$Path, $Body = $null) {
  $headers = @{ Accept = 'application/json' }
  if ($script:SessionSecret) { $headers['X-Nowplaying-Session'] = $script:SessionSecret }
  $params = @{ Method = $Method; Uri = "$Base$Path"; TimeoutSec = 10; UseBasicParsing = $true; Headers = $headers }
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

# Optional Spotify sign-in (#135): card and hosted card only, never Discord.
function Invoke-Spotify($Body) {
  try { return Invoke-Setup 'POST' '/api/setup/spotify' $Body }
  catch {
    $code = $null
    try { $code = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { }
    if (-not $code) {
      try {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $code = ($reader.ReadToEnd() | ConvertFrom-Json).error
      } catch { }
    }
    $message = if ($code -and $SpotifyErrors.ContainsKey([string]$code)) { $SpotifyErrors[[string]$code] } else { "Spotify sign-in didn't work. Check the Client ID and try again." }
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
  $script:TestResult = $null
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

$spotifyTimer = [System.Windows.Forms.Timer]::new()
$spotifyTimer.Interval = 2000

function Stop-Spotify { $spotifyTimer.Stop(); $script:Spotify.FlowId = $null }

function Complete-Spotify($Result) {
  if ($Result.status -eq 'signed_in') {
    Stop-Spotify
    $script:Draft = (Invoke-Setup 'GET' '/api/setup/draft').draft
  } elseif ($Result.status -eq 'pending' -and $script:Spotify.FlowId) {
    $spotifyTimer.Start()
  }
}

$onSpotifyStart = {
  $errorLabel.Text = ''
  Stop-Spotify
  $script:Spotify.ClientId = Get-Field 'spotifyClientId'
  $form.UseWaitCursor = $true
  try {
    $result = Invoke-Spotify @{ action = 'start'; clientId = $script:Spotify.ClientId }
    if ($result.status -eq 'pending') {
      $script:Spotify.FlowId = [string]$result.flowId
      if ($result.authUrl -and ([string]$result.authUrl).StartsWith('https://accounts.spotify.com/') -and -not $SelfTest) { Start-Process ([string]$result.authUrl) }
    }
    Complete-Spotify $result
  } catch {
    $script:LastError = $_.Exception.Message
    $errorLabel.Text = $_.Exception.Message
  } finally { $form.UseWaitCursor = $false }
  Show-Step
}

$spotifyTimer.add_Tick({
  $spotifyTimer.Stop()
  if (-not $script:Spotify.FlowId) { return }
  try { Complete-Spotify (Invoke-Spotify @{ action = 'poll'; flowId = $script:Spotify.FlowId }) }
  catch { Stop-Spotify; $script:LastError = $_.Exception.Message; $errorLabel.Text = $_.Exception.Message }
  if (-not $script:Spotify.FlowId) { Show-Step }
})

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
    if ($control.Name -eq 'discordArtworkLookup') { $changes.discordArtworkLookup = [bool]$control.Checked }
    if ($control.Name -eq 'startWithWindows') { $changes.startWithWindows = [bool]$control.Checked }
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

function Get-AccountLabel($Account) { "$($Providers[[string]$Account.provider]) (signed in as $($Account.displayName))" }
function Get-AddedServers { @($script:Draft.servers | Where-Object { $_ }) }

function New-ActionButton([string]$Name, [string]$Text, $OnClick) {
  $button = [System.Windows.Forms.Button]::new()
  $button.Name = $Name; $button.AutoSize = $true; $button.Text = $Text
  $button.add_Click($OnClick)
  $button
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
      # Several servers (#252): after "Add another server" this step picks the next one.
      $adding = (@(Get-AddedServers).Count -gt 0) -and -not $script:Draft.account
      $title.Text = if ($adding) { 'Which server do you want to add?' } else { 'Which media server do you use?' }
      if ($adding) { $panel.Controls.Add((New-Text ("Already added: " + ((Get-AddedServers | ForEach-Object { Get-AccountLabel $_ }) -join ', ')))) }
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
      # A server found above isn't listed again below.
      $foundKinds = @($found | ForEach-Object { [string]$_.provider })
      $others = @($Providers.Keys | Where-Object { $foundKinds -notcontains $_ })
      if ($others.Count -gt 0) { $panel.Controls.Add((New-Text $(if ($found.Count -gt 0) { 'Or choose another server:' } else { 'No server found running on this PC. Choose yours:' }))) }
      foreach ($key in $others) {
        $radio = [System.Windows.Forms.RadioButton]::new()
        $radio.Text = $Providers[$key]; $radio.Tag = $key; $radio.AutoSize = $true
        if (-not $checkedOne -and $script:Draft.provider -eq $key) { $radio.Checked = $true; $checkedOne = $true }
        $radio.add_CheckedChanged({ Update-Buttons })
        $panel.Controls.Add($radio)
      }
      if ($adding) { $panel.Controls.Add((New-ActionButton 'cancelAddServer' "Don't add another server" $onCancelAddServer)) }
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
      if ($script:Draft.account) {
        $test = [System.Windows.Forms.Button]::new()
        $test.Name = 'testConnection'; $test.AutoSize = $true; $test.Text = 'Test connection'
        $test.add_Click($onTestConnection)
        $panel.Controls.Add($test)
        if ($script:TestResult) {
          $resultLabel = New-Text $script:TestResult
          $resultLabel.Name = 'connectionResult'
          $panel.Controls.Add($resultLabel)
        }
        $panel.Controls.Add((New-ActionButton 'addServer' 'Add another server' $onAddServer))
      }
      if ($script:Draft.account) {
        $spotifyTitle = New-Text 'Spotify on your card (optional)'
        $spotifyTitle.Font = [System.Drawing.Font]::new($spotifyTitle.Font, [System.Drawing.FontStyle]::Bold)
        $spotifyTitle.Margin = [System.Windows.Forms.Padding]::new(0, 14, 0, 6)
        $panel.Controls.Add($spotifyTitle)
        if ($script:Draft.spotify) {
          $connected = New-Text "Connected as $($script:Draft.spotify.identity.displayName). Spotify shows on your card only, not on Discord."
          $connected.Name = 'spotifyAccount'
          $panel.Controls.Add($connected)
          $panel.Controls.Add((New-ActionButton 'spotifyClear' 'Disconnect Spotify' $onSpotifyClear))
        } else {
          $panel.Controls.Add((New-Text 'Shows what you play on Spotify on your card and hosted card, never on Discord. You need a Client ID from your own app in the Spotify developer dashboard, with http://127.0.0.1/spotify/callback as its redirect URI.'))
          [void](New-Field 'spotifyClientId' 'Spotify Client ID' $script:Spotify.ClientId)
          if ($script:Spotify.FlowId) { $panel.Controls.Add((New-Text "Finish signing in on the Spotify page in your browser. This window updates when you're done.")) }
          $panel.Controls.Add((New-ActionButton 'spotifyStart' $(if ($script:Spotify.FlowId) { 'Open Spotify sign-in again' } else { 'Sign in with Spotify' }) $onSpotifyStart))
        }
      }
      if (@(Get-AddedServers).Count -gt 0) { $panel.Controls.Add((New-Text ("Also added: " + ((Get-AddedServers | ForEach-Object { Get-AccountLabel $_ }) -join ', ')))) }
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
      $art = [System.Windows.Forms.CheckBox]::new()
      $art.Name = 'discordArtworkLookup'; $art.Text = 'Look up album art online'; $art.AutoSize = $true; $art.Checked = ($script:Draft.discordArtworkLookup -ne $false)
      $panel.Controls.Add($art)
      $panel.Controls.Add((New-Text 'Sends only the track title and artist to MusicBrainz to find the cover. Your server address and account are never sent.'))
      if ($null -ne $script:Draft.startWithWindows) {
        $startup = [System.Windows.Forms.CheckBox]::new()
        $startup.Name = 'startWithWindows'; $startup.Text = 'Start NowPlaying when I sign in to Windows'; $startup.AutoSize = $true; $startup.Checked = [bool]$script:Draft.startWithWindows
        $panel.Controls.Add($startup)
      }
    }
    'review' {
      $title.Text = 'Check your choices'
      $provider = if ($script:Draft.provider) { $Providers[[string]$script:Draft.provider] } else { 'Not chosen' }
      $status = if ($script:Draft.discordEnabled) { 'On' } else { 'Off' }
      $who = if ($script:Draft.account) { " as $($script:Draft.account.displayName)" } else { '' }
      if (@(Get-AddedServers).Count -gt 0) {
        # Every added server can be removed here; the one signed in last stays.
        $panel.Controls.Add((New-Text 'Media servers:'))
        foreach ($server in @(Get-AddedServers)) {
          $panel.Controls.Add((New-Text (Get-AccountLabel $server)))
          $remove = New-ActionButton 'removeServer' 'Remove' $onRemoveServer
          $remove.Tag = @{ provider = [string]$server.provider; id = [string]$server.id }
          $panel.Controls.Add($remove)
        }
        if ($script:Draft.account) { $panel.Controls.Add((New-Text (Get-AccountLabel $script:Draft.account))) }
      } else {
        $panel.Controls.Add((New-Text "Media server: $provider$who"))
      }
      $panel.Controls.Add((New-Text "Discord status: $status - when idle: $($Idle[[string]$script:Draft.discordIdleBehavior])"))
      $panel.Controls.Add((New-Text "Spotify on your card: $(if ($script:Draft.spotify) { "On (signed in as $($script:Draft.spotify.identity.displayName))" } else { 'Off' })"))
      $panel.Controls.Add((New-Text "Album art lookup: $(if ($script:Draft.discordArtworkLookup -ne $false) { 'On' } else { 'Off' })"))
      if ($null -ne $script:Draft.startWithWindows) { $panel.Controls.Add((New-Text "Start with Windows: $(if ($script:Draft.startWithWindows) { 'On' } else { 'Off' })")) }
    }
    default {
      $title.Text = 'All set'
      $panel.Controls.Add((New-Text 'Close this window and NowPlaying starts. Look for its icon in the taskbar tray (under the ^ arrow if it is hidden).'))
    }
  }
  $panel.ResumeLayout()
  Update-Buttons
}

function Send-Step([string]$Method, $Body) {
  $errorLabel.Text = ''
  Stop-SignIn
  $script:TestResult = $null
  $form.UseWaitCursor = $true
  try { $script:Draft = (Invoke-Setup $Method '/api/setup/draft' $Body).draft }
  catch {
    $script:LastError = $_.Exception.Message
    $code = $null
    if ($_.ErrorDetails.Message) { try { $code = [string]($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { $code = $null } }
    $errorLabel.Text = if ($code -and $DraftErrors.ContainsKey($code)) { $DraftErrors[$code] } else { "Couldn't save that step. Check NowPlaying is still running and try again." }
  }
  finally { $form.UseWaitCursor = $false }
  Show-Step
}

# Asks the app to check the saved sign-in against the server once. The reply
# is only a status word; nothing sensitive comes back.
$onTestConnection = {
  $form.UseWaitCursor = $true
  try {
    $reply = try { Invoke-Setup 'POST' '/api/setup/test' @{} } catch {
      $text = $_.ErrorDetails.Message
      if ($text) { try { $text | ConvertFrom-Json } catch { $null } } else { $null }
    }
    $status = [string]$reply.status
    $script:TestResult = if ($TestMessages.ContainsKey($status)) { $TestMessages[$status] } else { "Couldn't run the test. Check NowPlaying is still running and try again." }
  } finally { $form.UseWaitCursor = $false }
  Show-Step
}

$onSpotifyClear = { Stop-Spotify; Send-Step 'POST' @{ action = 'clear-spotify' } }
$onAddServer = { Send-Step 'POST' @{ action = 'add-server' } }
$onCancelAddServer = { Send-Step 'POST' @{ action = 'cancel-add-server' } }
$onRemoveServer = { param($sender) Send-Step 'POST' @{ action = 'remove-server'; server = $sender.Tag } }
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
  if (-not @($panel.Controls | Where-Object { $_.Name -eq 'testConnection' })[0]) { throw 'sign-in step has no Test connection button after sign-in' }
  & $onTestConnection
  $resultText = [string]@($panel.Controls | Where-Object { $_.Name -eq 'connectionResult' })[0].Text
  if (-not ($TestMessages.Values -contains $resultText)) { throw "Test connection showed no known result: $resultText" }
  # Add another server, then change our mind: the account comes back (#252).
  if (-not @($panel.Controls | Where-Object { $_.Name -eq 'addServer' })[0]) { throw 'sign-in step has no Add another server button' }
  & $onAddServer
  if ($script:Draft.step -ne 'provider' -or $script:Draft.account -or @(Get-AddedServers).Count -ne 1) { throw "Add another server did not keep the account and go back to the server choice (step=$($script:Draft.step) servers=$(@(Get-AddedServers).Count) $($errorLabel.Text) $script:LastError)" }
  if ($title.Text -ne 'Which server do you want to add?') { throw "add-server step title was: $($title.Text)" }
  if (-not @($panel.Controls | Where-Object { $_.Name -eq 'cancelAddServer' })[0]) { throw 'add-server step has no cancel button' }
  & $onCancelAddServer
  # Spotify (#135): the section is offered after sign-in; a bad Client ID is caught before any sign-in starts.
  if (-not @($panel.Controls | Where-Object { $_.Name -eq 'spotifyStart' })[0]) { throw 'sign-in step has no Sign in with Spotify button' }
  @($panel.Controls | Where-Object { $_.Name -eq 'spotifyClientId' })[0].Text = 'not-a-client-id'
  & $onSpotifyStart
  if ($errorLabel.Text -ne $SpotifyErrors['bad_client_id']) { throw "bad Spotify Client ID showed: $($errorLabel.Text)" }
  $errorLabel.Text = ''
  if ($script:Draft.step -ne 'signin' -or -not $script:Draft.account -or @(Get-AddedServers).Count -ne 0) { throw "cancelling Add another server did not restore the account ($($errorLabel.Text) $script:LastError)" }
  & $onNext
  & $onBack
  $seen += $script:Draft.step
  & $onNext; $seen += $script:Draft.step
  $startupBox = @($panel.Controls | Where-Object { $_.Name -eq 'startWithWindows' })[0]
  if ($null -ne $script:Draft.startWithWindows) {
    if (-not $startupBox) { throw 'discord step has no Start with Windows choice' }
    $startupBox.Checked = $true
  } elseif ($startupBox) { throw 'Start with Windows must be hidden when it is not offered' }
  foreach ($i in 1..2) { & $onNext; $seen += $script:Draft.step }
  if ($errorLabel.Text) { throw "self-test error: $($errorLabel.Text) ($script:LastError)" }
  [Console]::Out.Write((@{ ok = $true; steps = $seen; provider = $script:Draft.provider; account = $script:Draft.account.displayName; connectionTest = $resultText; startWithWindows = $script:Draft.startWithWindows } | ConvertTo-Json -Compress))
  $form.Dispose()
  exit 0
}

# The app starts this script with windowsHide so PowerShell's console stays
# hidden. That also starts the process with SW_HIDE, which Windows applies to
# the process's first ShowWindow call - the setup form itself - leaving an
# invisible dialog. Spend that first call on the not-yet-shown form, then show
# it normally and bring it to the front (a background process can't take focus
# on its own).
if (-not $ProbeWithoutShowFix) { [void][NowPlaying.Win32]::ShowWindow($form.Handle, 0) }
$form.add_Shown({
  $form.TopMost = $true
  $form.Activate()
  [void][NowPlaying.Win32]::SetForegroundWindow($form.Handle)
  $form.TopMost = $false
})

if ($VisibilityProbe) {
  # CI check: show the real window the way the app launches it, confirm Windows
  # reports it visible, then close.
  $script:ProbeVisible = $false
  $timer = [System.Windows.Forms.Timer]::new()
  $timer.Interval = 500
  $timer.add_Tick({ $timer.Stop(); $script:ProbeVisible = [NowPlaying.Win32]::IsWindowVisible($form.Handle); $form.Close() })
  $form.add_Shown({ $timer.Start() })
  [void]$form.ShowDialog()
  [Console]::Out.Write((@{ visible = [bool]$script:ProbeVisible } | ConvertTo-Json -Compress))
  $form.Dispose()
  exit 0
}

[System.Windows.Forms.Application]::EnableVisualStyles()
[void]$form.ShowDialog()
$form.Dispose()
