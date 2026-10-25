param(
  [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
  # Tauri embeds the app version in the file name (OHarness_<version>_x64-setup.exe),
  # including SemVer pre-releases such as 0.0.1-alpha, so match instead of hard-coding it.
  $nsisDirectory = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\nsis"
  $candidates = @()
  if (Test-Path -LiteralPath $nsisDirectory) {
    $candidates = @(Get-ChildItem -LiteralPath $nsisDirectory -Filter "OHarness_*_x64-setup.exe" -File)
  }
  if ($candidates.Count -eq 0) {
    throw "No installer matching OHarness_*_x64-setup.exe in $nsisDirectory. Build it first (npm run tauri:build) or pass -InstallerPath."
  }
  if ($candidates.Count -gt 1) {
    $names = ($candidates | ForEach-Object { $_.Name }) -join ", "
    throw "Found $($candidates.Count) installers in $nsisDirectory ($names). Remove the stale ones or pass -InstallerPath."
  }
  $InstallerPath = $candidates[0].FullName
}

$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
$installRoot = Join-Path $env:LOCALAPPDATA "Programs\OHarness"
$installer = Start-Process -FilePath $resolvedInstaller `
  -ArgumentList @("/S", "/D=$installRoot") `
  -PassThru `
  -Wait `
  -WindowStyle Hidden
if ($installer.ExitCode -ne 0) {
  throw "OHarness installer failed with code $($installer.ExitCode)"
}

$appPath = Join-Path $installRoot "oharness.exe"
# Windows caches shell icons (taskbar, Start, jump list on right-click). An
# upgrade in place keeps the stale icon until that cache is refreshed.
$ie4uinit = Join-Path $env:SystemRoot "System32\ie4uinit.exe"
if (Test-Path -LiteralPath $ie4uinit) {
  & $ie4uinit -show
}
if (-not (Test-Path -LiteralPath $appPath)) {
  throw "Installed OHarness executable was not found at $appPath"
}

$smoke = & powershell -NoProfile -ExecutionPolicy Bypass `
  -File (Join-Path $PSScriptRoot "smoke-desktop.ps1") `
  -AppPath $appPath
if ($LASTEXITCODE -ne 0) {
  throw "Installed OHarness smoke failed"
}

[pscustomobject]@{
  installer = $resolvedInstaller
  installer_exit = $installer.ExitCode
  installed_app = (Resolve-Path -LiteralPath $appPath).Path
  smoke = ($smoke | ConvertFrom-Json)
} | ConvertTo-Json -Compress -Depth 4
