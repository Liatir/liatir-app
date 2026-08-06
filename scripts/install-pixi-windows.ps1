#Requires -Version 5.1
<#
.SYNOPSIS
Installs the exact reviewed pixi executable and conda-pack on Windows CI hosts.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$PixiHome,
  [Parameter(Mandatory = $true)][string]$ExpectedSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$normalizedVersion = $Version.TrimStart('v')
if ($normalizedVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid pixi version: $Version" }
if ($ExpectedSha256 -notmatch '^[a-f0-9]{64}$') { throw 'ExpectedSha256 must be lowercase SHA-256.' }

$binDirectory = Join-Path $PixiHome 'bin'
$pixiPath = Join-Path $binDirectory 'pixi.exe'
$downloadPath = Join-Path $PixiHome 'pixi.download.exe'
$assetUrl = "https://github.com/prefix-dev/pixi/releases/download/v$normalizedVersion/pixi-x86_64-pc-windows-msvc.exe"

New-Item -ItemType Directory -Path $binDirectory -Force | Out-Null
try {
  & curl.exe --fail --location --retry 3 --output $downloadPath $assetUrl
  if ($LASTEXITCODE -ne 0) { throw "pixi download failed with exit code $LASTEXITCODE." }
  $actualSha256 = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $ExpectedSha256) {
    throw "pixi SHA-256 mismatch: $actualSha256"
  }
  Move-Item -LiteralPath $downloadPath -Destination $pixiPath -Force
} finally {
  Remove-Item -LiteralPath $downloadPath -Force -ErrorAction SilentlyContinue
}

& $pixiPath global install 'conda-pack==0.9.2'
if ($LASTEXITCODE -ne 0) { throw "conda-pack installation failed with exit code $LASTEXITCODE." }
