param(
  [string]$AppPath = "",
  # Hosted CI runners start the WebView2 browser without --remote-debugging-port
  # (observed on windows-latest), so the DOM probe cannot attach there. With this
  # switch the run only tolerates that one case: check-webview.mjs exit code 3,
  # meaning the debugging endpoint never answered. It is then reported as a
  # warning (and in the job summary) with diagnostics. Any other probe failure
  # (endpoint answered but no page target, wrong title, document not complete,
  # empty body) still fails the run, as do sidecar health, window close and
  # cleanup. Local runs (install-desktop.ps1, `npm run desktop:smoke`) keep the
  # probe required.
  [switch]$WebViewOptional
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AppPath)) {
  $AppPath = Join-Path $PSScriptRoot "..\src-tauri\target\release\oharness.exe"
}

$resolvedApp = (Resolve-Path -LiteralPath $AppPath).Path
$appDirectory = Split-Path -Parent $resolvedApp
$sidecarPath = (Resolve-Path -LiteralPath (Join-Path $appDirectory "oharness-sidecar.exe")).Path

$existingApp = @(Get-CimInstance Win32_Process -Filter "Name = 'oharness.exe'")
$existingSidecars = @(Get-CimInstance Win32_Process -Filter "Name = 'oharness-sidecar.exe'" |
  Where-Object { $_.ExecutablePath -eq $sidecarPath })
if ($existingApp.Count -gt 0 -or $existingSidecars.Count -gt 0) {
  $runningPaths = @($existingApp | ForEach-Object { $_.ExecutablePath } | Where-Object { $_ }) -join ", "
  throw "Desktop smoke requires no existing OHarness process because the app is single-instance. Close: $runningPaths"
}

$debugListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$debugListener.Start()
$debugPort = ($debugListener.LocalEndpoint).Port
$debugListener.Stop()
$previousWebViewArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$debugPort"
$app = Start-Process -FilePath $resolvedApp -PassThru -WindowStyle Hidden
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousWebViewArguments
try {
  $listener = $null
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if ($app.HasExited) {
      throw "OHarness exited during startup with code $($app.ExitCode)"
    }

    $sidecars = @(Get-CimInstance Win32_Process -Filter "Name = 'oharness-sidecar.exe'" |
      Where-Object { $_.ExecutablePath -eq $sidecarPath })
    if ($sidecars.Count -gt 0) {
      $sidecarPids = $sidecars.ProcessId
      $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object {
          $sidecarPids -contains $_.OwningProcess -and
          $_.LocalAddress -in @("127.0.0.1", "::1")
        } |
        Select-Object -First 1
      if ($null -ne $listener) { break }
    }
    Start-Sleep -Milliseconds 250
  }

  if ($null -eq $listener) {
    throw "OHarness sidecar did not expose a loopback listener"
  }

  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($listener.LocalPort)/health" -TimeoutSec 3
  if ($health.status -ne "ok") {
    throw "OHarness sidecar health was '$($health.status)'"
  }

  $webView = & node (Join-Path $PSScriptRoot "check-webview.mjs") $debugPort
  $webViewStatus = "rendered"
  $webViewExit = $LASTEXITCODE
  if ($webViewExit -ne 0) {
    $app.Refresh()
    $state = if ($app.HasExited) { "exited with code $($app.ExitCode)" } else { "still running" }
    $webViewProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'")
    # Browser process = the one without --type=; shows whether the debug flag arrived.
    foreach ($process in $webViewProcesses | Where-Object { $_.CommandLine -notmatch '--type=' }) {
      Write-Host "WebView2 browser process $($process.ProcessId): $($process.CommandLine)"
      Get-NetTCPConnection -State Listen -OwningProcess $process.ProcessId -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host "  listening on $($_.LocalAddress):$($_.LocalPort)" }
    }
    Write-Host "Expected debug port: $debugPort"
    # check-webview.mjs exits 3 only when the debugging endpoint never answered;
    # every other non-zero code means the WebView was reachable but wrong.
    $endpointUnavailable = ($webViewExit -eq 3)
    $message = "OHarness WebView did not render (probe exit $webViewExit; app $state; msedgewebview2 processes: $($webViewProcesses.Count))"
    if (-not $WebViewOptional -or -not $endpointUnavailable -or $app.HasExited) {
      throw $message
    }
    $note = "$message; the DevTools endpoint on port $debugPort never answered, so the DOM probe was skipped in this run"
    Write-Host "::warning title=Desktop smoke::$note"
    if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_STEP_SUMMARY)) {
      Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "### Desktop smoke`n`n- WebView DOM probe: **unverified**. $note. Sidecar health passed."
    }
    $webViewStatus = "unverified"
    $webView = '{}'
  }

  if (-not $app.CloseMainWindow()) {
    throw "OHarness did not expose a closable main window"
  }
  $app.WaitForExit(10000) | Out-Null
  if (-not $app.HasExited) {
    throw "OHarness did not exit after its main window closed"
  }

  Start-Sleep -Seconds 2
  $remaining = @(Get-CimInstance Win32_Process -Filter "Name = 'oharness-sidecar.exe'" |
    Where-Object { $_.ExecutablePath -eq $sidecarPath })
  if ($remaining.Count -ne 0) {
    throw "OHarness left $($remaining.Count) sidecar process(es) after exit"
  }
  if (
    (Test-Path -LiteralPath (Join-Path $appDirectory "harness.db")) -or
    (Test-Path -LiteralPath (Join-Path $appDirectory "secrets"))
  ) {
    throw "OHarness wrote persistent user data into its installation directory"
  }

  [pscustomobject]@{
    app = $resolvedApp
    health = $health.status
    loopback = $listener.LocalAddress
    port = $listener.LocalPort
    webview_status = $webViewStatus
    webview = ($webView | ConvertFrom-Json)
    app_closed = $true
    remaining_sidecars = 0
    install_directory_clean = $true
  } | ConvertTo-Json -Compress
}
finally {
  if (-not $app.HasExited) {
    Stop-Process -Id $app.Id -Force
  }
  @(Get-CimInstance Win32_Process -Filter "Name = 'oharness-sidecar.exe'" |
    Where-Object { $_.ExecutablePath -eq $sidecarPath }) |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}
