#Requires -Version 5
<#
.SYNOPSIS
  dapperline installer for Windows PowerShell.

.DESCRIPTION
  git clone https://github.com/dev-2nan/dapperline.git $HOME\.dapperline
  & $HOME\.dapperline\install.ps1

  or, without cloning first:

  irm https://raw.githubusercontent.com/dev-2nan/dapperline/main/install.ps1 | iex

  Set $env:DAPPERLINE_DIR to install somewhere other than ~\.dapperline.
#>

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Die($m) { Write-Host "`nerror: $m" -ForegroundColor Red; exit 1 }

$Repo = if ($env:DAPPERLINE_REPO) { $env:DAPPERLINE_REPO } else { 'https://github.com/dev-2nan/dapperline.git' }
$Dest = if ($env:DAPPERLINE_DIR)  { $env:DAPPERLINE_DIR }  else { Join-Path $HOME '.dapperline' }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die 'node not found. dapperline needs Node.js 18 or newer.'
}
# Parse the version in PowerShell rather than passing a quoted expression to
# node -p; PowerShell strips the inner quotes before node ever sees them.
$nodeVersion = (& node -p 'process.versions.node').Trim()
$major = [int]($nodeVersion -split '\.')[0]
if ($major -lt 18) { Die "node v$nodeVersion is too old. dapperline needs 18 or newer." }

# Run from a clone? Install that clone in place. Otherwise fetch one.
# $PSScriptRoot is empty under `irm | iex`, which is exactly the fetch case.
$src = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'dapperline.js'))) {
  $src = $PSScriptRoot
  Write-Host 'dapperline: using this checkout' -ForegroundColor Cyan
} else {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Die 'git not found, and no local checkout to install from.'
  }
  if (Test-Path (Join-Path $Dest '.git')) {
    Write-Host 'dapperline: updating existing install' -ForegroundColor Cyan
    & git -C $Dest pull --ff-only --quiet
    if ($LASTEXITCODE -ne 0) { Die "could not update $Dest - pull manually and re-run." }
  } else {
    if (Test-Path $Dest) { Die "$Dest exists but is not a git checkout. Move it aside and re-run." }
    Write-Host 'dapperline: cloning' -ForegroundColor Cyan
    & git clone --quiet --depth 1 $Repo $Dest
    if ($LASTEXITCODE -ne 0) { Die 'clone failed. Private repo? Set up SSH or a token first.' }
  }
  $src = $Dest
}
Write-Host "  source     $src"

& node (Join-Path $src 'scripts\patch-settings.js') (Join-Path $src 'dapperline.js')
if ($LASTEXITCODE -ne 0) { Die 'could not update settings.json' }

# Prove it renders before declaring success - a status line that errors just
# shows up blank, with nothing to tell you why.
Write-Host ''
Write-Host 'dapperline: test render' -ForegroundColor Cyan
$payload = '{"model":{"display_name":"Opus 5"},"workspace":{"current_dir":"."},"cwd":".","context_window":{"used_percentage":42,"total_input_tokens":420000,"context_window_size":1000000},"effort":{"level":"high"},"thinking":{"enabled":true},"rate_limits":{"five_hour":{"used_percentage":14},"seven_day":{"used_percentage":61}}}'
# Windows PowerShell pipes to native commands using the console encoding,
# which prepends a BOM. Suppress it for the duration of the render.
$prevEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
try { $out = $payload | & node (Join-Path $src 'dapperline.js') }
finally { [Console]::OutputEncoding = $prevEncoding }
if ($LASTEXITCODE -ne 0) { Die 'dapperline.js failed to run.' }
$out | ForEach-Object { Write-Host "  $_" }

Write-Host ''
Write-Host 'Done. Restart Claude Code, or wait for the next update, to see it.' -ForegroundColor Green
