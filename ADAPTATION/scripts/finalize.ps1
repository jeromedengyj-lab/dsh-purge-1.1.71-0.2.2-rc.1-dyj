#Requires -Version 5.1
<#
  finalize.ps1 - Stage C of the adapter. Run this AFTER "Clean -> Apply" has
  succeeded and AFTER the desktop app has been fully closed.

  Why this exists: on some Windows setups dsh-purge's PowerShell asar-swap
  helper is blocked by local security policy. The patch is written into
  resources\app, but app.asar is still present, so Electron keeps loading the
  untouched archive. Worse, reapply.js sees a sealed asar on every boot and
  keeps re-applying + restarting -> crash loop.

  This script completes the two steps the helper failed to do:
    1. Move resources\app.asar -> resources\app.asar.bak (reversible).
    2. Inject the 3-level fallback shim into dsh.cmd using the plugin's own
       repairOfficialCliAfterUnpack().

  Usage:
    powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\finalize.ps1 -CheckOnly
    powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\finalize.ps1
    powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\finalize.ps1 -StopHost
#>
[CmdletBinding()]
param(
  [string]$HarnessRoot = "D:\app\DeepSeek Harness",
  [string]$DshHome = "$env:USERPROFILE\.dsh",
  [string]$NodeExe = "",
  [switch]$CheckOnly,
  [switch]$StopHost
)

$ErrorActionPreference = "Stop"
function Step([string]$m) { Write-Host ""; Write-Host ("== " + $m + " ==") -ForegroundColor Cyan }
function Say([string]$m) { Write-Host $m }
function Ok([string]$m) { Write-Host ("[ OK ] " + $m) -ForegroundColor Green }
function Warn([string]$m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host ("[FAIL] " + $m) -ForegroundColor Red; exit 1 }

$Exe = Join-Path $HarnessRoot "DeepSeek Harness.exe"
$Cli = Join-Path $HarnessRoot "resources\runtime\cli\bin\dsh.cmd"
$Resources = Join-Path $HarnessRoot "resources"
$Asar = Join-Path $Resources "app.asar"
$AsarBak = Join-Path $Resources "app.asar.bak"
$AppDir = Join-Path $Resources "app"
$PluginDir = Join-Path $DshHome "plugins\dsh-purge"
$Applied = Join-Path $DshHome "dsh-purge\applied.json"
$ShimScript = Join-Path $PSScriptRoot "finalize-shim.mjs"

Step "1 / Preconditions"
if (-not (Test-Path -LiteralPath $Exe)) { Fail ("Desktop exe not found: " + $Exe) }
if (-not (Test-Path -LiteralPath $Applied)) {
  Fail "dsh-purge\applied.json not found. Open DSH and click Clean -> Apply first."
}
$appliedRaw = Get-Content -LiteralPath $Applied -Raw
Say ("  applied.json: " + ($appliedRaw -replace "\s+", " "))
foreach ($f in @("package.json", "lib\main.js", "dsh\node_modules\@deepseek-ai\dsh-system-prompt\lib\index.js")) {
  if (-not (Test-Path -LiteralPath (Join-Path $AppDir $f))) { Fail ("unpacked host is incomplete: " + $f) }
}
Ok "applied.json present and resources\app looks complete"

$running = @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
  if ($StopHost) {
    Warn ("Stopping " + $running.Count + " DeepSeek Harness processes (unsaved UI state may be lost).")
    $running | Stop-Process -Force -Confirm:$false -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $still = @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue)
    if ($still.Count -gt 0) { Fail "some processes are still alive; close them manually and retry" }
    Ok "desktop app stopped"
  } else {
    Fail ("DeepSeek Harness is running (" + $running.Count + " processes). Quit it completely via the tray icon, or pass -StopHost.")
  }
} else { Ok "desktop app is fully closed" }

if (-not $NodeExe) {
  $candidate = Join-Path $HarnessRoot "resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path -LiteralPath $candidate) { $NodeExe = $candidate }
  else {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $NodeExe = $cmd.Source } else { Fail "node.exe not found; pass -NodeExe <path>" }
  }
}

if ($CheckOnly) { Step "CheckOnly done"; Ok "preconditions satisfied, nothing was written"; exit 0 }

Step "2 / Unseal the host (app.asar -> app.asar.bak)"
if (Test-Path -LiteralPath $Asar) {
  if (Test-Path -LiteralPath $AsarBak) { Fail "app.asar.bak already exists; resolve manually before proceeding" }
  $done = $false
  for ($i = 1; $i -le 5; $i++) {
    try {
      Move-Item -LiteralPath $Asar -Destination $AsarBak -ErrorAction Stop
      $done = $true
      break
    } catch {
      Write-Host ("  attempt " + $i + " failed (file may still be locked), retrying...")
      Start-Sleep -Seconds 1
    }
  }
  if (-not $done) { Fail "could not move app.asar; make sure every DSH process is gone" }
  Ok ("moved; preserved " + (Get-Item -LiteralPath $AsarBak).Length + " bytes")
} else {
  if (-not (Test-Path -LiteralPath $AsarBak)) { Fail "neither app.asar nor app.asar.bak exists; installation is broken" }
  Ok "already unsealed (app.asar.bak present)"
}

Step "3 / Inject CLI shim"
& $NodeExe $ShimScript $PluginDir $Exe
if ($LASTEXITCODE -ne 0) { Fail "shim injection failed" }
$cmd = Get-Content -LiteralPath $Cli -Raw
if ($cmd -notmatch "dsh-purge cli entry begin") { Fail "dsh.cmd does not contain the injected shim" }
if ($cmd -notmatch "\.\.\\\.\.\\\.\.\\app\\dsh") { Warn "3rd-level fallback to resources\app not found in dsh.cmd" }
Ok ("dsh.cmd is " + (Get-Item -LiteralPath $Cli).Length + " bytes with 3-level fallback")

Step "4 / Verify"
$version = (& $Cli --version 2>&1 | Select-Object -First 1).ToString().Trim()
if ($version -ne "0.2.2-rc.1") { Fail ("CLI broken after unseal: '" + $version + "'") }
Ok ("dsh.cmd --version = " + $version)
$verify = Join-Path $PSScriptRoot "verify.mjs"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
& $NodeExe $verify --plugin-dir $PluginDir --dsh-home $DshHome --harness-root $HarnessRoot --repo $repo --strict
if ($LASTEXITCODE -ne 0) { Warn "verifier reported failures; review above" }

Step "Stage C complete"
Write-Host ""
Say "Reopen DeepSeek Harness now. Do NOT click Apply again."
Say "Rollback: powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\rollback.ps1"
