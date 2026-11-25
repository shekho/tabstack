# Builds dist/tabstack-<version>.zip for the Edge Add-ons store (also works for
# the Chrome Web Store). Only files the extension needs at runtime are included.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content "$root/manifest.json" -Raw | ConvertFrom-Json).version
$stage = Join-Path ([IO.Path]::GetTempPath()) "tabstack-$version"
$out = Join-Path $root "dist/tabstack-$version.zip"

Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage, (Split-Path $out) | Out-Null
Copy-Item "$root/manifest.json" $stage
foreach ($dir in '_locales', 'src') { Copy-Item -Recurse "$root/$dir" $stage }
New-Item -ItemType Directory -Force "$stage/icons" | Out-Null
Copy-Item "$root/icons/*.png" "$stage/icons"

Remove-Item -Force $out -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage/*" -DestinationPath $out
Remove-Item -Recurse -Force $stage
Write-Host "Created $out"
