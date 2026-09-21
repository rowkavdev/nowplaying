$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Version = (Get-Content (Join-Path $Root 'package.json') | ConvertFrom-Json).version
$Bundle = Join-Path $Root "dist/windows/nowplaying-v$Version-windows-x64"

Remove-Item (Join-Path $Root 'dist/windows') -Recurse -Force -ErrorAction SilentlyContinue
New-Item (Join-Path $Bundle 'runtime') -ItemType Directory -Force | Out-Null
New-Item (Join-Path $Bundle 'app') -ItemType Directory -Force | Out-Null

# Compile the tiny native launcher. Node and Sharp remain real files so native loading is reliable.
csc /nologo /target:exe /out:(Join-Path $Bundle 'nowplaying.exe') (Join-Path $Root 'scripts/windows-launcher.cs')
Copy-Item (Get-Command node).Source (Join-Path $Bundle 'runtime/node.exe')
Copy-Item (Join-Path $Root 'src') (Join-Path $Bundle 'app/src') -Recurse
Copy-Item (Join-Path $Root 'scripts') (Join-Path $Bundle 'app/scripts') -Recurse
Copy-Item (Join-Path $Root 'node_modules') (Join-Path $Bundle 'app/node_modules') -Recurse
Copy-Item (Join-Path $Root 'package.json') (Join-Path $Bundle 'app/package.json')
Copy-Item (Join-Path $Root 'LICENSE') (Join-Path $Bundle 'LICENSE')
Copy-Item (Join-Path $Root 'NOTICE') (Join-Path $Bundle 'NOTICE')

& (Join-Path $Bundle 'nowplaying.exe') --version
& (Join-Path $Bundle 'nowplaying.exe') --help
Compress-Archive -Path (Join-Path $Bundle '*') -DestinationPath "$Bundle.zip"
Write-Output "$Bundle.zip"
