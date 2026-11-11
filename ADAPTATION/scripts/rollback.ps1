#Requires -Version 5.1
<#
  rollback.ps1 - Restore the official host and profile to the pre-adapter state.

  Restores from the backup dir recorded in $DshHome\last-adapter-backup.txt
  (or -BackupDir), plus the two reversible host swaps:
    - resources\app.asar.bak  -> resources\app.asar
    - cli\bin\dsh.cmd.dsh-purge.bak -> cli\bin\dsh.cmd

  It does NOT revert the code patches inside resources\app. Use
  `node bin/dsh-purge.js --revert` for that, or simply delete resources\app
  after restoring app.asar. See ADAPTATION/README.md for the full procedure.

  Usage:
    powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\rollback.ps1 -CheckOnly
    powershell -ExecutionPolicy Bypass -File .\ADAPTATION\scripts\rollback.ps1 -RemovePlugin
#>
[CmdletBinding()]
param(
  [string]$HarnessRoot = "D:\app\DeepSeek Harness",
  [string]$DshHome = "$env:USERPROFILE\.dsh",
  [string]$Profile = "desktop",
  [string]$BackupDir = "",
  [switch]$CheckOnly,
  [switch]$RemovePlugin
)

$ErrorActionPreference = "Stop"
function Step([string]$m) { Write-Host ""; Write-Host ("== " + $m + " ==") -ForegroundColor Cyan }
function Say([string]$m) { Write-Host $m }
function WriteUtf8NoBom([string]$p, [string]$text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $text, $enc)
}
function Ok([string]$m) { Write-Host ("[ OK ] " + $m) -ForegroundColor Green }
function Warn([string]$m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host ("[FAIL] " + $m) -ForegroundColor Red; exit 1 }

if (-not $BackupDir) {
  $marker = Join-Path $DshHome "last-adapter-backup.txt"
  if (Test-Path -LiteralPath $marker) { $BackupDir = (Get-Content -LiteralPath $marker -Raw).Trim() }
}
if (-not $BackupDir -or -not (Test-Path -LiteralPath $BackupDir)) {
  Fail "no backup dir found; pass -BackupDir <path>"
}
Say ("  backup : " + $BackupDir)

$Resources = Join-Path $HarnessRoot "resources"
$Asar = Join-Path $Resources "app.asar"
$AsarBak = Join-Path $Resources "app.asar.bak"
$Cli = Join-Path $HarnessRoot "resources\runtime\cli\bin\dsh.cmd"
$CliBak = "$Cli.dsh-purge.bak"
$ProfileDir = Join-Path $DshHome ("profiles\" + $Profile)

Step "0 / Preconditions"
$running = @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) { Fail "Quit DeepSeek Harness completely before rolling back (tray icon -> Quit)." }
Ok "desktop app is closed"
if ($CheckOnly) { Ok "checks passed, nothing was changed"; exit 0 }

Step "1 / Restore official host files"
if ((Test-Path -LiteralPath $AsarBak) -and -not (Test-Path -LiteralPath $Asar)) {
  Move-Item -LiteralPath $AsarBak -Destination $Asar -Force
  Ok "app.asar restored"
} elseif (Test-Path -LiteralPath $Asar) {
  Ok "app.asar already in place"
} else {
  Warn "app.asar.bak missing; restoring from backup dir copy"
  $copy = Join-Path $BackupDir "app.asar"
  if (Test-Path -LiteralPath $copy) { Copy-Item -LiteralPath $copy -Destination $Asar -Force; Ok "app.asar restored from backup" }
  else { Fail "cannot restore app.asar: no source available" }
}
if (Test-Path -LiteralPath $CliBak) {
  Copy-Item -LiteralPath $CliBak -Destination $Cli -Force
  Ok "dsh.cmd restored to official 243-byte original"
} else {
  $copy = Join-Path $BackupDir "dsh.cmd"
  if (Test-Path -LiteralPath $copy) { Copy-Item -LiteralPath $copy -Destination $Cli -Force; Ok "dsh.cmd restored from backup" }
  else { Warn "no dsh.cmd backup found" }
}

Step "2 / Restore profile configs"
foreach ($rel in @("package.json", "cordis.yml", "cordis.patch.yml", "pnpm-lock.yaml")) {
  $src = Join-Path $BackupDir ("profile-" + $rel)
  if (Test-Path -LiteralPath $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $ProfileDir $rel) -Force
    Ok ("restored " + $rel)
  }
}
$rootPatch = Join-Path $BackupDir "root-cordis.patch.yml"
if (Test-Path -LiteralPath $rootPatch) {
  Copy-Item -LiteralPath $rootPatch -Destination (Join-Path $DshHome "cordis.patch.yml") -Force
  Ok "restored root cordis.patch.yml"
}

if ($RemovePlugin) {
  Step "3 / Remove plugin"
  $pkgPath = Join-Path $ProfileDir "package.json"
  $pkg = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
  if ($pkg.dependencies.PSObject.Properties.Name -contains "dsh-purge") {
    $pkg.dependencies.PSObject.Properties.Remove("dsh-purge")
  }
  if ($pkg.dsh.profile.bundles) {
    $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne "dsh-purge" })
  }
  WriteUtf8NoBom $pkgPath ($pkg | ConvertTo-Json -Depth 20)
  $cli = Join-Path $HarnessRoot "resources\runtime\cli\bin\dsh.cmd"
  & $cli plugin --profile $Profile install 2>&1 | Select-Object -Last 4 | ForEach-Object { Say ("    " + $_) }
  Ok "bundle/dependency removed from profile"
  Say "  plugin sources left at: $(Join-Path $DshHome 'plugins\dsh-purge') (delete manually if you want)"
} else {
  Say ""
  Say "  Plugin sources and bundle registration were kept. Use -RemovePlugin to drop them."
}

Step "Rollback complete"
Say "Reopen DeepSeek Harness."
Say "Note: resources\app (patched unpacked host) is still on disk but ignored while app.asar exists."
Say "      Delete it manually once you have confirmed the official host works."
