#Requires -Version 5.1
<#
  install.ps1 - Stage A of the dsh-purge 1.1.71 adapter for DeepSeek Harness 0.2.2-rc.1 (Windows).

  What it does (idempotent):
    1. Preflight: locate the desktop app, verify version, require the app to be fully closed.
    2. Back up profile configs, app.asar and dsh.cmd into a timestamped backup dir.
    3. Copy the already-fixed plugin sources into $DshHome\plugins\dsh-purge.
    4. Register the plugin in the target profile using the file: protocol, then run plugin install.
    5. Sync the fixed redteam preset into the runtime preset dir.
    6. Run the offline verifier (static checks).

  It deliberately does NOT apply host patches or touch app.asar. Stage B/C are:
    - reopen DSH, click dsh-purge -> Clean -> Apply once
    - run finalize.ps1 after the app is fully closed
    - reopen DSH

  Usage:
    powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\install.ps1 -CheckOnly
    powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\install.ps1
    powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\install.ps1 -HarnessRoot "E:\Apps\DeepSeek Harness" -Profile desktop
#>
[CmdletBinding()]
param(
  [string]$HarnessRoot = "D:\app\DeepSeek Harness",
  [string]$Profile = "desktop",
  [string]$DshHome = "$env:USERPROFILE\.dsh",
  [string]$PluginSource = "",
  [string]$NodeExe = "",
  [switch]$CheckOnly,
  [switch]$SkipVersionCheck,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$EXPECTED_VERSION = "0.2.2-rc.1"
$PLUGIN_NAME = "dsh-purge"

function Say([string]$msg) { Write-Host $msg }
function WriteUtf8NoBom([string]$p, [string]$text) {
  # PowerShell 5.1's -Encoding UTF8 writes a BOM; Node's JSON.parse would fail.
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $text, $enc)
}
function Step([string]$msg) { Write-Host ""; Write-Host ("== " + $msg + " ==") -ForegroundColor Cyan }
function Fail([string]$msg) { Write-Host ("[FAIL] " + $msg) -ForegroundColor Red; exit 1 }
function Warn([string]$msg) { Write-Host ("[WARN] " + $msg) -ForegroundColor Yellow }
function Ok([string]$msg) { Write-Host ("[ OK ] " + $msg) -ForegroundColor Green }

if (-not $PluginSource) {
  $PluginSource = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$PluginSource = (Resolve-Path $PluginSource).Path
$AdaptDir = Join-Path $PluginSource "ADAPTATION"

Step "0 / Paths"
Say ("  repo        : " + $PluginSource)
Say ("  harness     : " + $HarnessRoot)
Say ("  dsh home    : " + $DshHome)
Say ("  profile     : " + $Profile)
if (-not (Test-Path -LiteralPath (Join-Path $PluginSource "package.json"))) { Fail "package.json missing in repo root" }
if (-not (Test-Path -LiteralPath (Join-Path $AdaptDir "patches\all.patch"))) { Fail "ADAPTATION/patches/all.patch missing" }

$Exe = Join-Path $HarnessRoot "DeepSeek Harness.exe"
$Cli = Join-Path $HarnessRoot "resources\runtime\cli\bin\dsh.cmd"
$Resources = Join-Path $HarnessRoot "resources"
$ProfileDir = Join-Path $DshHome ("profiles\" + $Profile)
$ProfilePkg = Join-Path $ProfileDir "package.json"
$PluginDir = Join-Path $DshHome ("plugins\" + $PLUGIN_NAME)

Step "1 / Preflight"
if (-not (Test-Path -LiteralPath $Exe)) { Fail ("Desktop exe not found: " + $Exe) }
if (-not (Test-Path -LiteralPath $Cli)) { Fail ("dsh.cmd not found: " + $Cli) }
if (-not (Test-Path -LiteralPath $ProfilePkg)) { Fail ("Profile package.json not found: " + $ProfilePkg) }
Ok "desktop app, CLI and profile found"

$version = ""
try { $version = (& $Cli --version 2>&1 | Select-Object -First 1).ToString().Trim() } catch { }
Say ("  dsh version : " + $version)
if (-not $SkipVersionCheck) {
  if ($version -ne $EXPECTED_VERSION) {
    Fail ("This adapter targets dsh " + $EXPECTED_VERSION + ", found '" + $version + "'. Re-check with -SkipVersionCheck only if you know what you are doing.")
  }
  Ok "version matches"
} else { Warn "version check skipped" }

$running = @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
  Fail ("DeepSeek Harness is still running (" + $running.Count + " processes). Use the tray icon -> Quit completely, then run this script again. This script never kills your session.")
}
Ok "desktop app is fully closed"

if (-not $NodeExe) {
  $candidate = Join-Path $HarnessRoot "resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path -LiteralPath $candidate) { $NodeExe = $candidate }
  else {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $NodeExe = $cmd.Source } else { Fail "node.exe not found; pass -NodeExe <path>" }
  }
}
if (-not (Test-Path -LiteralPath $NodeExe)) { Fail ("node not found: " + $NodeExe) }
Ok ("node: " + $NodeExe)

if ($CheckOnly) { Step "CheckOnly done"; Ok "preflight passed, nothing was written"; exit 0 }

Step "2 / Backup"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $DshHome ("backup-adapter-" + $stamp)
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
foreach ($rel in @("package.json", "cordis.yml", "cordis.patch.yml", "pnpm-lock.yaml")) {
  $src = Join-Path $ProfileDir $rel
  if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $BackupDir ("profile-" + $rel)) -Force }
}
$rootPatch = Join-Path $DshHome "cordis.patch.yml"
if (Test-Path -LiteralPath $rootPatch) { Copy-Item -LiteralPath $rootPatch -Destination (Join-Path $BackupDir "root-cordis.patch.yml") -Force }
$asar = Join-Path $Resources "app.asar"
if (Test-Path -LiteralPath $asar) {
  Copy-Item -LiteralPath $asar -Destination (Join-Path $BackupDir "app.asar") -Force
  Ok "app.asar backed up (213 MB, may take a moment)"
}
if (Test-Path -LiteralPath $Cli) { Copy-Item -LiteralPath $Cli -Destination (Join-Path $BackupDir "dsh.cmd") -Force }
if (Test-Path -LiteralPath $PluginDir) {
  $existing = Join-Path $BackupDir "plugin-source"
  New-Item -ItemType Directory -Path $existing -Force | Out-Null
  Get-ChildItem -LiteralPath $PluginDir -Force | Where-Object { $_.Name -ne ".git" -and $_.Name -ne "node_modules" } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $existing -Recurse -Force
  }
}
Write-Output $BackupDir | Set-Content -LiteralPath (Join-Path $DshHome "last-adapter-backup.txt") -Encoding ASCII
Ok ("backup: " + $BackupDir)

Step "3 / Install fixed plugin sources"
if ((Test-Path -LiteralPath $PluginDir) -and -not $Force) {
  Say "  plugin dir already exists; overwrite with the fixed sources (backup was made in step 2)."
}
New-Item -ItemType Directory -Path $PluginDir -Force | Out-Null
Get-ChildItem -LiteralPath $PluginSource -Force | Where-Object { $_.Name -ne ".git" -and $_.Name -ne "ADAPTATION" -and $_.Name -ne "node_modules" } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $PluginDir -Recurse -Force
}
foreach ($f in @("lib\core.js", "lib\desktop.js", "lib\index.js", "lib\redteam\index.js", "presets\redteam\agent.cordis.yml")) {
  if (-not (Test-Path -LiteralPath (Join-Path $PluginDir $f))) { Fail ("missing plugin file: " + $f) }
}
Ok "plugin sources copied"

Step "4 / Register in profile"
$pkg = Get-Content -LiteralPath $ProfilePkg -Raw | ConvertFrom-Json
$dep = ""
if ($pkg.dependencies -and $pkg.dependencies.PSObject.Properties.Name -contains $PLUGIN_NAME) { $dep = $pkg.dependencies.$PLUGIN_NAME }
if ($dep -ne "file:../../plugins/dsh-purge") {
  Say ("  current dependency: '" + $dep + "' -> running plugin add")
  & $Cli plugin --profile $Profile add $PluginDir 2>&1 | ForEach-Object { Say ("    " + $_) }
  if ($LASTEXITCODE -ne 0) { Fail "dsh plugin add failed" }
} else { Ok "dependency already uses file: protocol" }

$raw = Get-Content -LiteralPath $ProfilePkg -Raw
$raw = $raw -replace '"dsh-purge"\s*:\s*"link:[^"]*"', '"dsh-purge": "file:../../plugins/dsh-purge"'
if ($raw -notmatch '"dsh-purge"\s*:\s*"file:\.\./\.\./plugins/dsh-purge"') {
  Fail "could not force file: protocol in profile package.json"
}
WriteUtf8NoBom $ProfilePkg $raw

$pkg2 = Get-Content -LiteralPath $ProfilePkg -Raw | ConvertFrom-Json
$bundles = @($pkg2.dsh.profile.bundles)
if ($bundles -notcontains $PLUGIN_NAME) {
  $pkg2.dsh.profile.bundles = @($bundles) + @($PLUGIN_NAME)
  WriteUtf8NoBom $ProfilePkg ($pkg2 | ConvertTo-Json -Depth 20)
  Ok "bundle registered"
} else { Ok "bundle already registered" }
& $Cli plugin --profile $Profile install 2>&1 | Select-Object -Last 6 | ForEach-Object { Say ("    " + $_) }
if ($LASTEXITCODE -ne 0) { Warn "plugin install returned non-zero; check the output above" }
Ok "profile registration done"

Step "5 / Sync runtime redteam preset"
$runtimePreset = Join-Path $DshHome ".agent-presets\redteam\agent.cordis.yml"
$fixedPreset = Join-Path $PluginDir "presets\redteam\agent.cordis.yml"
if (Test-Path -LiteralPath $runtimePreset) {
  $rt = Get-Content -LiteralPath $runtimePreset -Raw
  $rowDisabled = $rt -match '(?s)- id: tool-subagent-list-agents.{0,220}disabled: true'
  $hasToolFilter = $rt.Contains("toolFilter:")
  if ($rowDisabled -and -not $hasToolFilter) {
    Ok "runtime preset already fixed; local edits preserved"
  } else {
    Copy-Item -LiteralPath $runtimePreset -Destination (Join-Path $BackupDir "runtime-redteam-preset.yml") -Force
    Copy-Item -LiteralPath $fixedPreset -Destination $runtimePreset -Force
    Ok "runtime preset replaced by fixed source (old copy kept in backup)"
  }
} else {
  New-Item -ItemType Directory -Path (Split-Path $runtimePreset -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $fixedPreset -Destination $runtimePreset -Force
  Ok "runtime preset created from fixed source"
}

Step "6 / Offline verifier"
$verify = Join-Path $AdaptDir "scripts\verify.mjs"
& $NodeExe $verify --plugin-dir $PluginDir --dsh-home $DshHome --harness-root $HarnessRoot --repo $PluginSource
if ($LASTEXITCODE -ne 0) { Fail "verifier reported failures; review the output above before continuing" }

Step "Stage A complete"
Write-Host ""
Say "Next steps:"
Say "  1. Open DeepSeek Harness."
Say "  2. Open the dsh-purge panel -> Clean -> Apply (once). It should pass with no crash."
Say "  3. Quit the app completely (tray icon -> Quit)."
Say "  4. Run: powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\finalize.ps1"
Say "  5. Reopen the app. Do NOT click Apply again."
Say ""
Say ("Backup dir: " + $BackupDir)
