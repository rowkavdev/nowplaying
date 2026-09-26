# Exercise the assets users download, not a fresh rebuild of the repository.
$ErrorActionPreference = 'Stop'
$repo = 'rowkavdev/nowplaying'
$root = Join-Path $env:RUNNER_TEMP 'nowplaying-dev-artifact-check'
New-Item -ItemType Directory -Path $root -Force | Out-Null
$release = gh release view dev --repo $repo --json assets,tagName | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $release.tagName -ne 'dev') { throw 'Dev release lookup failed' }
$tag = (gh api "repos/$repo/git/ref/tags/dev" --jq '.object.sha').Trim()
if ($LASTEXITCODE -ne 0 -or $tag -notmatch '^[a-f0-9]{40}$') { throw "Dev tag lookup failed: $tag" }
$files = @('nowplaying-dev-windows-x64-setup.exe', 'nowplaying-dev-windows-x64.zip', 'SHA256SUMS')
foreach ($name in $files) {
  $asset = @($release.assets | Where-Object name -eq $name)
  if ($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:[a-f0-9]{64}$') { throw "Missing asset/digest: $name" }
  gh release download dev --repo $repo --dir $root --pattern $name
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $name" }
  $actual = (Get-FileHash (Join-Path $root $name) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $asset[0].digest.Substring(7)) { throw "GitHub digest mismatch: $name" }
}
$manifest = [IO.File]::ReadAllText((Join-Path $root 'SHA256SUMS'))
if ($manifest.Contains("`r") -or $manifest[0] -eq [char]0xfeff) { throw 'SHA256SUMS has CR or BOM' }
foreach ($name in $files[0..1]) {
  $digest = (Get-FileHash (Join-Path $root $name) -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not $manifest.Contains("$digest  $name`n")) { throw "SHA256SUMS mismatch: $name" }
  gh attestation verify (Join-Path $root $name) --repo $repo --signer-workflow "$repo/.github/workflows/beta.yml"
  if ($LASTEXITCODE -ne 0) { throw "Provenance verification failed: $name" }
}
function Test-Bundle($dir, $label) {
  $exe = Join-Path $dir 'nowplaying.exe'
  if (-not (Test-Path $exe)) { throw "$label has no launcher" }
  $info = Get-Content (Join-Path $dir 'app/build-info.json') -Raw | ConvertFrom-Json
  if ($info.commitSha -ne $tag) { throw "$label was built from $($info.commitSha), not dev tag $tag" }
  Write-Host "Testing $label bundle at $dir"
  Push-Location $dir
  try {
    $version = (& $exe --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -ne '0.2.0') { throw "$label version failed: $version" }
    $data = Join-Path $root "data-$label"
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    $env:LOCALAPPDATA = $data
    $env:NOWPLAYING_PORT = if ($label -eq 'installer') { '47842' } else { '47843' }
    $stdout = Join-Path $root "$label-out.log"
    $stderr = Join-Path $root "$label-err.log"
    $app = Start-Process -FilePath $exe -ArgumentList 'start','--no-tray','--no-setup' -WorkingDirectory $dir -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    try {
      $base = "http://127.0.0.1:$env:NOWPLAYING_PORT"
      $ready = $false
      for ($i = 0; $i -lt 100; $i++) {
        if ($app.HasExited) { throw "$label exited $($app.ExitCode): $(Get-Content $stderr -Raw)" }
        try { if ((Invoke-WebRequest "$base/settings" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready = $true; break } } catch {}
        Start-Sleep -Milliseconds 300
      }
      if (-not $ready) { throw "$label did not serve first-run Settings: stdout=$(Get-Content $stdout -Raw); stderr=$(Get-Content $stderr -Raw); process=$($app.HasExited)" }
      $page = Invoke-WebRequest "$base/settings" -UseBasicParsing
      if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'Set up NowPlaying') { throw "$label first-run WebUI missing" }
      $servers = Invoke-RestMethod "$base/api/settings/servers"
      if (-not $servers.firstRun) { throw "$label did not enter first-run" }
      $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
      $settingsPage = Invoke-WebRequest "$base/settings" -UseBasicParsing -WebSession $session
      $discovery = Invoke-RestMethod "$base/api/settings/servers/discover" -Method Post -ContentType 'application/json' -Body '{"subnet":""}' -WebSession $session
      if ($null -eq $discovery.servers) { throw "$label discovery API failed" }
      Write-Host "${label}: version, launch, first-run WebUI and discovery API passed"
    } finally {
      taskkill /PID $app.Id /T /F | Out-Null
    }
  } finally { Pop-Location }
}
$zipDir = Join-Path $root 'portable'
Expand-Archive (Join-Path $root $files[1]) $zipDir -Force
Test-Bundle $zipDir 'portable'
$installDir = Join-Path $root 'installed'
$installer = Join-Path $root $files[0]
$setup = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS',"/DIR=$installDir" -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw "Installer exited $($setup.ExitCode)" }
try { Test-Bundle $installDir 'installer' }
finally {
  $uninstall = Join-Path $installDir 'unins000.exe'
  if (Test-Path $uninstall) { $un = Start-Process -FilePath $uninstall -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru -Wait; if ($un.ExitCode -ne 0) { throw "Uninstall failed: $($un.ExitCode)" } }
}
$tagAfter = (gh api "repos/$repo/git/ref/tags/dev" --jq '.object.sha').Trim()
if ($LASTEXITCODE -ne 0 -or $tagAfter -ne $tag) { throw "Dev tag moved during test ($tag -> $tagAfter); rerun for the new build" }
Write-Host "Both downloaded dev artifacts exercised on Windows at $tag."
