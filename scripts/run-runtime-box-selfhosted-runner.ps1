#Requires -Version 5.1
<#
.SYNOPSIS
Runs exactly one repository-scoped, ephemeral GitHub Actions job on this Windows host.

.DESCRIPTION
Windows counterpart of scripts/run-runtime-box-selfhosted-runner.sh, holding the same contract:
a dedicated runner root outside the repository checkout, a marker file guarding cleanup, a
bootstrap disk floor, an online-time cap, single concurrency, and automatic deregistration plus
full removal of the runner root after success, failure, or interruption. Every operational
parameter (label, name prefix, disk floor) is read from runtime-boxes/catalog.json through
`runtime-box-ci.mjs resolve`, so the launcher and CI can never disagree.
#>
[CmdletBinding()]
param(
  [string]$Model = '',
  [string]$Target = '',
  [string]$Mode = '',
  [string]$Foundation = '',
  [Parameter(Mandatory = $true)][string]$RunnerRoot,
  [switch]$PreflightOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Repository = 'Liatir/liatir-app'
$RunnerVersion = '2.336.0'
# Pinned from https://github.com/actions/runner/releases/tag/v2.336.0
$RunnerArchiveSha256 = 'd59123a43003e357b0805b5d0f611d0bd2f65ab67d51bd070dd4e7a0f685c162'
$RunnerArchive = "actions-runner-win-x64-$RunnerVersion.zip"
$RunnerArchiveUrl = "https://github.com/actions/runner/releases/download/v$RunnerVersion/$RunnerArchive"
$RunnerOnlineTimeoutSeconds = 11400
$MaxWindowsCondaPrefixLength = 150
$MarkerName = '.liatir-runtime-box-runner'
$RunnerName = ''
$RunnerProcess = $null

function Fail([string]$message, [int]$code = 1) {
  Write-Error $message
  exit $code
}

if (-not [System.IO.Path]::IsPathRooted($RunnerRoot)) { Fail '--RunnerRoot must be an explicit absolute path.' 2 }
$RunnerRoot = [System.IO.Path]::GetFullPath($RunnerRoot)
if ($RunnerRoot -eq [System.IO.Path]::GetPathRoot($RunnerRoot)) { Fail 'A drive root cannot be used as a runner root.' 2 }
if ($RunnerRoot -eq $RepositoryRoot -or $RunnerRoot.StartsWith($RepositoryRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  Fail 'The runner root must be outside the repository checkout.' 2
}
if (Test-Path -LiteralPath $RunnerRoot) {
  $existing = Get-Item -LiteralPath $RunnerRoot -Force
  if ($existing.Attributes.HasFlag([System.IO.FileAttributes]::ReparsePoint)) {
    Fail 'The runner root cannot be a reparse point.' 2
  }
}

if (-not [string]::IsNullOrEmpty($Foundation)) {
  if (-not [string]::IsNullOrEmpty($Model) -or -not [string]::IsNullOrEmpty($Target) -or -not [string]::IsNullOrEmpty($Mode)) {
    Fail '-Foundation cannot be combined with -Model, -Target, or -Mode.' 2
  }
} elseif ([string]::IsNullOrEmpty($Model) -or [string]::IsNullOrEmpty($Target) -or [string]::IsNullOrEmpty($Mode)) {
  Fail 'Provide either -Foundation or all of -Model, -Target, and -Mode.' 2
}

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { Fail "Unsupported self-hosted host architecture: $env:PROCESSOR_ARCHITECTURE" }
foreach ($command in @('gh', 'node')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { Fail "Missing required command: $command" }
}

# Resolve the runner contract from the catalog; never hardcode labels or floors here.
if (-not [string]::IsNullOrEmpty($Foundation)) {
  $resolution = & node (Join-Path $RepositoryRoot 'scripts/runtime-box-ci.mjs') resolve-foundation `
    --recipe $Foundation
} else {
  $resolution = & node (Join-Path $RepositoryRoot 'scripts/runtime-box-ci.mjs') resolve `
    --model $Model --target $Target --mode $Mode --native-requested false
}
if ($LASTEXITCODE -ne 0) { Fail 'Target resolution failed.' }
$resolved = $resolution | ConvertFrom-Json
if ("$($resolved.self_hosted)" -ne 'true') { Fail 'The resolved target is not self-hosted.' }
# Checked explicitly: this launcher is invoked by hand, so a target belonging to another OS must be
# refused before anything is registered, not discovered when the job fails to build.
if ([string]$resolved.runner_platform -ne 'windows' -or [string]$resolved.runner_arch -ne 'x86_64') {
  Fail "Target runner is $($resolved.runner_platform)/$($resolved.runner_arch) but this host is windows/x86_64."
}
if ([string]::IsNullOrEmpty($Foundation)) {
  $buildDirectoryRelative = [string]$resolved.build_dir_relative
  if ([string]::IsNullOrWhiteSpace($buildDirectoryRelative) -or [System.IO.Path]::IsPathRooted($buildDirectoryRelative) -or $buildDirectoryRelative.StartsWith('..')) {
    Fail "Unsafe configured Runtime Box build directory: $buildDirectoryRelative"
  }
  # Pixi relocates files inside the prefix. On Windows, longer prefixes can rewrite conda-managed
  # bytecode and make conda-pack correctly reject the environment, so fail before registration.
  $expectedCondaPrefix = Join-Path $RunnerRoot "_work\liatir-app\liatir-app\$buildDirectoryRelative\$($resolved.recipe_id)\pixi-workspace\.pixi\envs\default"
  if ($expectedCondaPrefix.Length -gt $MaxWindowsCondaPrefixLength) {
    Fail "Runner root is too long for a relocatable Windows conda prefix ($($expectedCondaPrefix.Length) characters; maximum $MaxWindowsCondaPrefixLength): $RunnerRoot"
  }
}
$runnerLabel = [string]$resolved.runs_on
$runnerNamePrefix = [string]$resolved.runner_name_prefix
$minimumBootstrapFreeDiskBytes = [int64]$resolved.minimum_bootstrap_free_disk_bytes

$availableBytes = (New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($RunnerRoot))).AvailableFreeSpace
if ($availableBytes -lt $minimumBootstrapFreeDiskBytes) {
  Fail "Self-hosted runner preflight failed: $availableBytes free bytes; $minimumBootstrapFreeDiskBytes required before setup."
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Fail 'Missing required command: gh (needed to mint the runner registration token)'
}
& gh auth status --hostname github.com | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'GitHub CLI is not authenticated.' }

# Filtering happens here rather than through `--jq`: Windows PowerShell drops the quotes around a
# jq string literal when it hands arguments to a native executable, and jq then reads the label as
# an expression. A single page of 100 is ample — this launcher enforces one runner per label.
$inventory = (& gh api "repos/$Repository/actions/runners?per_page=100") | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { Fail 'Unable to read the repository runner inventory.' }
$conflicting = @($inventory.runners | Where-Object { $_.labels.name -contains $runnerLabel })
if ($conflicting.Count -gt 0) {
  Fail "A runner with label $runnerLabel is already registered; refusing concurrent registration."
}

Write-Host "Self-hosted runner preflight passed for $runnerLabel with $availableBytes free bytes."
if ($PreflightOnly) { exit 0 }

if (Test-Path -LiteralPath $RunnerRoot) { Fail "Runner root already exists: $RunnerRoot" }
New-Item -ItemType Directory -Path $RunnerRoot | Out-Null
New-Item -ItemType File -Path (Join-Path $RunnerRoot $MarkerName) | Out-Null
$RunnerName = "$runnerNamePrefix$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())-$PID"

try {
  $archivePath = Join-Path $RunnerRoot $RunnerArchive
  # TLS 1.2 is not the default negotiation on stock Windows PowerShell 5.1.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $RunnerArchiveUrl -OutFile $archivePath -UseBasicParsing
  $actualSha256 = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $RunnerArchiveSha256) { Fail "Runner archive SHA-256 mismatch: $actualSha256" }
  Expand-Archive -Path $archivePath -DestinationPath $RunnerRoot -Force
  Remove-Item -LiteralPath $archivePath -Force

  $registrationToken = & gh api --method POST "repos/$Repository/actions/runners/registration-token" --jq .token
  if ($LASTEXITCODE -ne 0) { Fail 'Unable to mint a runner registration token.' }
  & (Join-Path $RunnerRoot 'config.cmd') `
    --unattended `
    --ephemeral `
    --disableupdate `
    --no-default-labels `
    --url "https://github.com/$Repository" `
    --token $registrationToken `
    --name $RunnerName `
    --labels $runnerLabel `
    --work _work
  if ($LASTEXITCODE -ne 0) { Fail 'Runner configuration failed.' }
  $registrationToken = $null

  Write-Host "Runner $RunnerName is online for exactly one matching job."
  $RunnerProcess = Start-Process -FilePath (Join-Path $RunnerRoot 'run.cmd') `
    -WorkingDirectory $RunnerRoot -NoNewWindow -PassThru
  if (-not $RunnerProcess.WaitForExit($RunnerOnlineTimeoutSeconds * 1000)) {
    Write-Warning "Runner online timeout reached; stopping $RunnerName."
    Stop-Process -Id $RunnerProcess.Id -Force -ErrorAction SilentlyContinue
    $RunnerProcess.WaitForExit()
  }
  exit $RunnerProcess.ExitCode
}
finally {
  if ($null -ne $RunnerProcess -and -not $RunnerProcess.HasExited) {
    Stop-Process -Id $RunnerProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if (-not [string]::IsNullOrEmpty($RunnerName)) {
    # Same reason as above: match by name here, not in a jq filter.
    try {
      $current = (& gh api "repos/$Repository/actions/runners?per_page=100" 2>$null) | ConvertFrom-Json
      $mine = @($current.runners | Where-Object { $_.name -eq $RunnerName })
      if ($mine.Count -gt 0) {
        & gh api --method DELETE "repos/$Repository/actions/runners/$($mine[0].id)" 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "GitHub runner deregistration failed for $RunnerName." }
      }
    } catch {
      Write-Warning "GitHub runner deregistration could not be attempted for $RunnerName."
    }
  }
  $diagnosticSource = Join-Path $RunnerRoot '_diag'
  if (Test-Path -LiteralPath $diagnosticSource) {
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $diagnosticRoot = Join-Path "$RunnerRoot.logs" "$stamp-$RunnerName"
    try {
      New-Item -ItemType Directory -Path $diagnosticRoot -Force | Out-Null
      Copy-Item -Path (Join-Path $diagnosticSource '*') -Destination $diagnosticRoot -Recurse -Force
    } catch {
      Write-Warning 'Runner diagnostic log retention failed.'
    }
  }
  # The marker proves this root was created by this launcher; never delete an unmarked directory.
  if (Test-Path -LiteralPath (Join-Path $RunnerRoot $MarkerName)) {
    Remove-Item -LiteralPath $RunnerRoot -Recurse -Force -ErrorAction SilentlyContinue
  } elseif (Test-Path -LiteralPath $RunnerRoot) {
    Write-Warning "Cleanup refused because the runner marker is missing: $RunnerRoot"
  }
}
