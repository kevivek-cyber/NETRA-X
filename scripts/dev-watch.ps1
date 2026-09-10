<#
.SYNOPSIS
  Run the shared server and redeploy it automatically as you edit code.

.DESCRIPTION
  Watches the source tree and reacts to what actually changed, because the two
  halves have very different costs and rules:

    apps/web/src   -> rebuild the static export (~30s). No restart needed: the
                      API reads the UI files from disk per request, so a
                      rebuild alone reaches every teammate on their next open.
    apps/api,      -> restart the server (~3s). Python is imported once at
    packages,         startup, so an edit is invisible until the process is
    workers           replaced.

  Teammates never reinstall anything for either -- the installer only carries
  the Rust shell.

  Polling rather than FileSystemWatcher: editors write temp files, rename over
  originals and touch directories, which fires several events per save and
  makes event-driven watching rebuild two or three times per keystroke burst.
  A 2s poll over modification times debounces that for free.

.PARAMETER Port
  Port to serve on. Default 8000.

.PARAMETER SkipInitialBuild
  Start from the existing apps/web/out instead of rebuilding first.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/dev-watch.ps1
#>
param(
    [int]$Port = 8000,
    [switch]$SkipInitialBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

$WebSources = @("apps\web\src")
$ApiSources = @("apps\api", "packages", "workers", "seed")

function Get-TreeStamp([string[]]$relativePaths, [string[]]$extensions) {
    # One string standing for "the current state of these files". Cheaper than
    # hashing contents, and a rename or delete changes it just as a save does.
    $parts = foreach ($rel in $relativePaths) {
        $full = Join-Path $RepoRoot $rel
        if (-not (Test-Path $full)) { continue }
        Get-ChildItem -Path $full -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object {
                $extensions -contains $_.Extension -and
                $_.FullName -notmatch '\\(node_modules|__pycache__|\.next)\\'
            } |
            ForEach-Object { "$($_.FullName)|$($_.LastWriteTimeUtc.Ticks)" }
    }
    ($parts | Sort-Object) -join "`n"
}

function Build-Web {
    Write-Host "[web] building static export..." -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot "apps\web")
    try {
        if (-not (Test-Path "node_modules")) { npm install }
        # No NEXT_PUBLIC_API_URL: the UI must call whatever host served it, so
        # one build works for every teammate regardless of this machine's
        # address. Baking one in sends each browser to its own machine.
        $env:NETRA_DESKTOP_BUILD = "1"
        Remove-Item Env:\NEXT_PUBLIC_API_URL -ErrorAction SilentlyContinue
        npm run build 2>&1 | Select-Object -Last 3
        Write-Host "[web] done -- teammates get it on their next open" -ForegroundColor Green
    } catch {
        # A syntax error must not kill the watcher: the next save is usually
        # the fix, and dropping out of the loop means the server dies too.
        Write-Warning "[web] build failed: $_"
    } finally {
        Remove-Item Env:\NETRA_DESKTOP_BUILD -ErrorAction SilentlyContinue
        Pop-Location
    }
}

$script:ServerProcess = $null

function Stop-Server {
    if ($script:ServerProcess -and -not $script:ServerProcess.HasExited) {
        # Kill the tree: uvicorn's reloader-free run is a single process, but a
        # stray child would keep port 8000 bound and the restart would fail
        # with "only one usage of each socket address".
        & taskkill /PID $script:ServerProcess.Id /T /F 2>&1 | Out-Null
    }
    $script:ServerProcess = $null
}

function Start-Server {
    Stop-Server
    $env:NETRAX_PORT = "$Port"
    Write-Host "[api] starting server on port $Port" -ForegroundColor Cyan
    $script:ServerProcess = Start-Process -FilePath $python `
        -ArgumentList (Join-Path $RepoRoot "apps\api\server_main.py") `
        -PassThru -NoNewWindow
}

# --- initial state ---------------------------------------------------------
if (-not $SkipInitialBuild) { Build-Web }
Start-Server

$webStamp = Get-TreeStamp $WebSources @(".ts", ".tsx", ".css", ".js")
$apiStamp = Get-TreeStamp $ApiSources @(".py")

Write-Host ""
Write-Host "=================================================================" -ForegroundColor DarkGray
Write-Host " Watching for changes. Ctrl+C to stop." -ForegroundColor Green
Write-Host "   apps/web/src            -> rebuild UI  (no restart)"
Write-Host "   apps/api, packages, ... -> restart API"
Write-Host "=================================================================" -ForegroundColor DarkGray
Write-Host ""

try {
    while ($true) {
        Start-Sleep -Seconds 2

        $newWeb = Get-TreeStamp $WebSources @(".ts", ".tsx", ".css", ".js")
        if ($newWeb -ne $webStamp) {
            Write-Host "[web] change detected" -ForegroundColor Yellow
            Build-Web
            # Re-stamp AFTER building: the build writes into apps/web/out, and
            # a slow save landing mid-build would otherwise be missed.
            $webStamp = Get-TreeStamp $WebSources @(".ts", ".tsx", ".css", ".js")
        }

        $newApi = Get-TreeStamp $ApiSources @(".py")
        if ($newApi -ne $apiStamp) {
            Write-Host "[api] change detected" -ForegroundColor Yellow
            Start-Server
            $apiStamp = $newApi
        }

        # A crash (bad import, port taken) should be visible and recoverable,
        # not a silently dead server that looks like a network problem.
        if ($script:ServerProcess -and $script:ServerProcess.HasExited) {
            Write-Warning "[api] server exited (code $($script:ServerProcess.ExitCode)). Restarting..."
            Start-Server
        }
    }
} finally {
    Write-Host "`nStopping server..." -ForegroundColor DarkGray
    Stop-Server
}
