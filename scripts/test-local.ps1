[CmdletBinding()]
param(
    [string]$Root = "",
    [string]$DownloadUrl = "",
    [switch]$Debugger
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$debugRoot = Join-Path $repoRoot ".action-debug\$PID"
New-Item -ItemType Directory -Force -Path $debugRoot | Out-Null

$env:GITHUB_ACTION_PATH = $repoRoot
$env:GITHUB_OUTPUT = Join-Path $debugRoot "github-output.txt"
$env:GITHUB_ENV = Join-Path $debugRoot "github-env.txt"
$env:GITHUB_PATH = Join-Path $debugRoot "github-path.txt"

Remove-Item -LiteralPath $env:GITHUB_OUTPUT, $env:GITHUB_ENV, $env:GITHUB_PATH -Force -ErrorAction SilentlyContinue
New-Item -ItemType File -Force -Path $env:GITHUB_OUTPUT, $env:GITHUB_ENV, $env:GITHUB_PATH | Out-Null

Set-Item -Path "Env:INPUT_ROOT" -Value $Root
Set-Item -Path "Env:INPUT_DOWNLOAD-URL" -Value $DownloadUrl
Set-Item -Path "Env:INPUT_DEBUGGER" -Value ($(if ($Debugger) { "true" } else { "false" }))

$entry = Join-Path $repoRoot "dist\index.js"
if (-not (Test-Path -LiteralPath $entry)) {
    throw "Missing dist\index.js. Run 'npm.cmd install' and 'npm.cmd run build' first."
}

node $entry
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Debug files: $debugRoot"
Write-Host ""
Write-Host "== GITHUB_OUTPUT =="
Get-Content -LiteralPath $env:GITHUB_OUTPUT

Write-Host ""
Write-Host "== GITHUB_ENV =="
Get-Content -LiteralPath $env:GITHUB_ENV

Write-Host ""
Write-Host "== GITHUB_PATH =="
Get-Content -LiteralPath $env:GITHUB_PATH
