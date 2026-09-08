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
  DESKTOP.md. The binary search below already prefers a release build, so the
  same shortcut picks that up with no change.

  Servers started here keep running after the window closes, so reopening is
  instant. Use -StopOnExit to shut them down with the window instead.

  -Silent is what the desktop shortcut uses (via start-netra-x.vbs): no
  console exists in that mode, so progress is dropped and failures are
  reported in a message box rather than written to a stream nobody can see.
#>

[CmdletBinding()]
param(
    # Stop the API and frontend when the desktop window closes.
    [switch]$StopOnExit,
    # No console output; surface failures in a dialog instead.
    [switch]$Silent,
    # Seconds to wait for each service before giving up.
    [int]$TimeoutSec = 120
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Write-Status {
    param([string]$Text, [string]$Colour = 'Gray', [switch]$NoNewline)
    if ($Silent) { return }
    Write-Host $Text -ForegroundColor $Colour -NoNewline:$NoNewline
}

function Stop-WithError {
    param([string]$Message)
    if ($Silent) {
        # Loaded on demand: the assembly costs ~40ms and is only needed when
        # something has already gone wrong.
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            $Message, 'NETRA-X',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    } else {
        Write-Host "  [ !! ] $Message" -ForegroundColor Red
        Read-Host '  Press Enter to close'
    }
    exit 1
}

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
            Write-Status "  [ OK ] $Label ready on :$Port" -Colour Green
            return $true
        }
        Start-Sleep -Milliseconds 700
        Write-Status '.' -Colour DarkGray -NoNewline
    }
    return $false
}

Write-Status ''
Write-Status '  NETRA-X' -Colour Cyan
Write-Status '  Dark Web Threat Actor Intelligence & Attribution' -Colour DarkGray
Write-Status ''

$started = @()

# --- 1. Backend ------------------------------------------------------------
if (Test-Port -Port 8000) {
    Write-Status '  [ -- ] api already running on :8000' -Colour DarkYellow
} else {
    $python = Join-Path $repo '.venv\Scripts\python.exe'
    if (-not (Test-Path $python)) { $python = 'python' }   # fall back to PATH

    Write-Status '  [ ** ] starting api ' -NoNewline
    $p = Start-Process -FilePath $python `
                       -ArgumentList 'apps/api/desktop_main.py' `
                       -WorkingDirectory $repo `
                       -WindowStyle Hidden -PassThru
    $started += $p
    if (-not (Wait-Port -Port 8000 -Label 'api' -Timeout $TimeoutSec)) {
        Stop-WithError "The NETRA-X backend did not start on port 8000 within ${TimeoutSec}s.`n`nCheck that the virtualenv exists at:`n$repo\.venv"
    }
}

# --- 2. Frontend -----------------------------------------------------------
if (Test-Port -Port 3000) {
    Write-Status '  [ -- ] frontend already running on :3000' -Colour DarkYellow
} else {
    Write-Status '  [ ** ] starting frontend ' -NoNewline
    # npm is a .cmd shim, so it has to go through cmd.exe to be spawnable.
    $p = Start-Process -FilePath 'cmd.exe' `
                       -ArgumentList '/c', 'npm', 'run', 'dev' `
                       -WorkingDirectory (Join-Path $repo 'apps\web') `
                       -WindowStyle Hidden -PassThru
    $started += $p
    if (-not (Wait-Port -Port 3000 -Label 'frontend' -Timeout $TimeoutSec)) {
        Stop-WithError "The NETRA-X frontend did not start on port 3000 within ${TimeoutSec}s.`n`nHave you run 'npm install' in apps\web?"
    }
}

# --- 3. Desktop window -----------------------------------------------------
# Release wins over debug: it is the optimised build, and -- the reason this
# matters here -- only release links as a WINDOWS-subsystem binary. A debug
# build is CONSOLE-subsystem and opens a terminal alongside the app, so
# launching one from a deliberately silent shortcut would undo the point of it.
#
# Two names per profile because the output depends on how it was built:
# `tauri dev`/`tauri build` rename the binary to the productName (NETRA-X.exe),
# while a plain `cargo build` leaves it under the crate name.
$candidates = @(
    (Join-Path $repo 'src-tauri\target\release\NETRA-X.exe'),
    (Join-Path $repo 'src-tauri\target\release\netra-x-desktop.exe'),
    (Join-Path $repo 'src-tauri\target\debug\NETRA-X.exe'),
    (Join-Path $repo 'src-tauri\target\debug\netra-x-desktop.exe')
)
$exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $exe) {
    Stop-WithError "No NETRA-X desktop binary was found.`n`nBuild one with:`n  cargo build --release   (in src-tauri)`n`nThe interface is still reachable at http://localhost:3000"
}

Write-Status '  [ OK ] launching window' -Colour Green
Write-Status ''

if ($StopOnExit) {
    Start-Process -FilePath $exe -Wait
    Write-Status '  Window closed, stopping services this launcher started.' -Colour DarkGray
    foreach ($p in $started) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
    }
} else {
    Start-Process -FilePath $exe
}
