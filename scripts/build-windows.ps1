$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Version = (Get-Content (Join-Path $Root 'package.json') | ConvertFrom-Json).version
$Bundle = Join-Path $Root "dist/windows/nowplaying-v$Version-windows-x64"




Remove-Item (Join-Path $Root 'dist/windows') -Recurse -Force -ErrorAction SilentlyContinue
New-Item (Join-Path $Bundle 'runtime') -ItemType Directory -Force | Out-Null
New-Item (Join-Path $Bundle 'app') -ItemType Directory -Force | Out-Null
& (Join-Path $Root 'scripts/generate-windows-icon.ps1')




# Compile the tiny native launcher. Node and Sharp remain real files so native loading is reliable.
dotnet new console --name Launcher --output (Join-Path $Root 'dist/launcher') --framework net8.0 --force | Out-Null
Copy-Item (Join-Path $Root 'scripts/windows-launcher.cs') (Join-Path $Root 'dist/launcher/Program.cs') -Force
dotnet publish (Join-Path $Root 'dist/launcher/Launcher.csproj') --configuration Release --runtime win-x64 --self-contained false -p:PublishSingleFile=true -p:UseAppHost=true -p:AssemblyName=nowplaying --output (Join-Path $Root 'dist/launcher/publish') | Out-Null
Copy-Item (Join-Path $Root 'dist/launcher/publish/nowplaying.exe') (Join-Path $Bundle 'nowplaying.exe')
# Same launcher as a Windows GUI program for shortcuts: no console window for end users.
dotnet publish (Join-Path $Root 'dist/launcher/Launcher.csproj') --configuration Release --runtime win-x64 --self-contained false -p:PublishSingleFile=true -p:UseAppHost=true -p:AssemblyName=nowplayingw -p:OutputType=WinExe -p:DefineConstants=NOWPLAYING_GUI --output (Join-Path $Root 'dist/launcher/publish-gui') | Out-Null
Copy-Item (Join-Path $Root 'dist/launcher/publish-gui/nowplayingw.exe') (Join-Path $Bundle 'nowplayingw.exe')
Copy-Item (Get-Command node).Source (Join-Path $Bundle 'runtime/node.exe')
Copy-Item (Join-Path $Root 'src') (Join-Path $Bundle 'app/src') -Recurse
Copy-Item (Join-Path $Root 'scripts') (Join-Path $Bundle 'app/scripts') -Recurse
Copy-Item (Join-Path $Root 'node_modules') (Join-Path $Bundle 'app/node_modules') -Recurse
Copy-Item (Join-Path $Root 'package.json') (Join-Path $Bundle 'app/package.json')
Copy-Item (Join-Path $Root 'LICENSE') (Join-Path $Bundle 'LICENSE')
Copy-Item (Join-Path $Root 'NOTICE') (Join-Path $Bundle 'NOTICE')
Copy-Item (Join-Path $Root 'assets') (Join-Path $Bundle 'assets') -Recurse

$Iscc = (Get-Command iscc.exe -ErrorAction SilentlyContinue).Source
if (-not $Iscc) { $Iscc = (Get-Command iscc -ErrorAction Stop).Source }
& $Iscc ('/DAppVersion=' + $Version) ('/DBundleDir=' + $Bundle) (Join-Path $Root 'scripts/windows-installer.iss')




& (Join-Path $Bundle 'nowplaying.exe') --version
& (Join-Path $Bundle 'nowplaying.exe') --help
# The GUI launcher must run the same app and exit cleanly without a console.
$gui = Start-Process -FilePath (Join-Path $Bundle 'nowplayingw.exe') -ArgumentList '--version' -WorkingDirectory $Bundle -Wait -PassThru
if ($gui.ExitCode -ne 0) { throw "nowplayingw.exe --version exited with $($gui.ExitCode)" }
Compress-Archive -Path (Join-Path $Bundle '*') -DestinationPath "$Bundle.zip"
Write-Output "$Bundle.zip"
