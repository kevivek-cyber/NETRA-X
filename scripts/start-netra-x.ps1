<#
  NETRA-X launcher.

  Brings up the three processes the console needs, in dependency order, and
  skips any that are already running so a second double-click attaches to the
  live session instead of fighting it for ports:

    1. FastAPI backend on 127.0.0.1:8000 (apps/api/desktop_main.py, SQLite)
    2. Next.js frontend on 127.0.0.1:3000
    3. The Tauri desktop window

  This is the development launcher. It needs the repo, its virtualenv and
  Node present, because the window loads the UI from the dev server rather
  than from a bundled static export. The self-contained installer -- no repo,
  no Node, embedded Python -- comes from `npm run desktop:build`; see
  DESKTOP.md. Point the shortcut at that instead once it is built.

  Servers started here keep running after the window closes, so reopening is
  instant. Use -StopOnExit to shut them down with the window instead.
#>

[CmdletBinding()]
param(
    # Stop the API and frontend when the desktop window closes.
    [switch]$StopOnExit,
    # Seconds to wait for each service before giving up.
    [int]$TimeoutSec = 120
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Test-Port {
    param([int]$Port)
    # TcpClient rather than Test-NetConnection: the latter takes ~1s per call
    # even on an immediate refusal, which makes the poll loops crawl.
    $client = New-Object Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $Port)
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-Port {
    param([int]$Port, [string]$Label, [int]$Timeout)
    $deadline = (Get-Date).AddSeconds($Timeout)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port -Port $Port) {
            Write-Host "  [ OK ] $Label ready on :$Port" -ForegroundColor Green
            return $true
        }
        Start-Sleep -Milliseconds 700
        Write-Host '.' -NoNewline -ForegroundColor DarkGray
    }
    Write-Host ''
    Write-Host "  [ !! ] $Label did not come up on :$Port within ${Timeout}s" -ForegroundColor Red
    return $false
}

Write-Host ''
Write-Host '  NETRA-X' -ForegroundColor Cyan
Write-Host '  Dark Web Threat Actor Intelligence & Attribution' -ForegroundColor DarkGray
Write-Host ''

$started = @()

# --- 1. Backend ------------------------------------------------------------
if (Test-Port -Port 8000) {
    Write-Host '  [ -- ] api already running on :8000' -ForegroundColor DarkYellow
} else {
    $python = Join-Path $repo '.venv\Scripts\python.exe'
    if (-not (Test-Path $python)) { $python = 'python' }   # fall back to PATH

    Write-Host '  [ ** ] starting api ' -NoNewline
    $p = Start-Process -FilePath $python `
                       -ArgumentList 'apps/api/desktop_main.py' `
                       -WorkingDirectory $repo `
                       -WindowStyle Hidden -PassThru
    $started += $p
    if (-not (Wait-Port -Port 8000 -Label 'api' -Timeout $TimeoutSec)) {
        Write-Host '  Backend failed to start. Is the virtualenv installed?' -ForegroundColor Red
        Read-Host '  Press Enter to close'
        exit 1
    }
}

# --- 2. Frontend -----------------------------------------------------------
if (Test-Port -Port 3000) {
    Write-Host '  [ -- ] frontend already running on :3000' -ForegroundColor DarkYellow
} else {
    Write-Host '  [ ** ] starting frontend ' -NoNewline
    # npm is a .cmd shim, so it has to go through cmd.exe to be spawnable.
    $p = Start-Process -FilePath 'cmd.exe' `
                       -ArgumentList '/c', 'npm', 'run', 'dev' `
                       -WorkingDirectory (Join-Path $repo 'apps\web') `
                       -WindowStyle Hidden -PassThru
    $started += $p
    if (-not (Wait-Port -Port 3000 -Label 'frontend' -Timeout $TimeoutSec)) {
        Write-Host '  Frontend failed to start. Have you run npm install?' -ForegroundColor Red
        Read-Host '  Press Enter to close'
        exit 1
    }
}

# --- 3. Desktop window -----------------------------------------------------
# Release build wins when both exist: it is the packaged artifact, and a stale
# debug binary sitting next to a fresh release one should not shadow it.
#
# Two names per profile because the output depends on how it was built:
# `tauri dev`/`tauri build` rename the binary to the productName (NETRA-X.exe),
# while a plain `cargo build` leaves it under the crate name. Only checking the
# Tauri name made the launcher report "no desktop binary found" next to a
# perfectly good one.
$candidates = @(
    (Join-Path $repo 'src-tauri\target\release\NETRA-X.exe'),
    (Join-Path $repo 'src-tauri\target\release\netra-x-desktop.exe'),
    (Join-Path $repo 'src-tauri\target\debug\NETRA-X.exe'),
    (Join-Path $repo 'src-tauri\target\debug\netra-x-desktop.exe')
)
$exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $exe) {
    Write-Host ''
    Write-Host '  [ !! ] no desktop binary found.' -ForegroundColor Red
    Write-Host '         Build one with:  npm run desktop:dev   (or desktop:build)' -ForegroundColor DarkGray
    Write-Host "         The UI is still usable at http://localhost:3000" -ForegroundColor DarkGray
    Read-Host '  Press Enter to close'
    exit 1
}

Write-Host "  [ OK ] launching window" -ForegroundColor Green
Write-Host ''

if ($StopOnExit) {
    Start-Process -FilePath $exe -Wait
    Write-Host '  Window closed, stopping services this launcher started.' -ForegroundColor DarkGray
    foreach ($p in $started) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
    }
} else {
    Start-Process -FilePath $exe
    Start-Sleep -Seconds 2
}
