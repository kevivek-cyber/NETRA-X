<#
.SYNOPSIS
  Run this machine as the NETRA-X host: server, public tunnel, and automatic
  redeploy whenever the tracked GitHub branch changes.

.DESCRIPTION
  One window, everything running:

    1. Builds the web UI and starts the shared server.
    2. Opens a Cloudflare tunnel so the app is reachable from anywhere.
    3. Polls GitHub on an interval and redeploys what actually changed.

  What "redeploy" means depends on what moved, because the three parts have
  genuinely different rules:

    apps/web/**      Rebuild the static export. No restart: the API reads
                     these files from disk per request, so teammates get the
                     new UI on their next open.
    *.py             Restart the server. Python is imported once at startup,
                     so an edit is invisible until the process is replaced.
    pyproject/reqs   Reinstall dependencies, then restart.
    src-tauri/**     Rebuild the INSTALLER. This one cannot be pushed to
                     anyone -- it is the native shell, so people must install
                     it. The fresh installer is published at /download/ on
                     this server so they can fetch it themselves.

  Local edits are picked up too: the same rules apply to files you change on
  this machine, so you do not have to commit to see your own work.

.PARAMETER Port
  Port to serve on. Default 8000.

.PARAMETER Remote
  Git remote to track. Default "origin".

.PARAMETER Branch
  Branch to track. Default "main".

.PARAMETER IntervalSeconds
  How often to check GitHub. Default 60.

.PARAMETER NoTunnel
  Serve on the LAN only; do not open a public tunnel.

.PARAMETER TunnelName
  Named Cloudflare tunnel to run (see `cloudflared tunnel create`). Falls back
  to an unnamed quick tunnel -- a random address that changes every restart --
  when this tunnel is not set up on the current machine (no credentials file
  in ~/.cloudflared). Default "netra-x".

.PARAMETER PublicHostname
  The DNS name routed to TunnelName (see `cloudflared tunnel route dns`).
  Only used to print the address; the tunnel itself does not need to be told
  its own hostname. Default "www.onnetra.in".

.PARAMETER SkipInitialBuild
  Start from the existing apps/web/out instead of rebuilding first. Restarting
  the host does not need a rebuild if nothing changed, and rebuilding deletes
  and recreates the export that is currently being served.

.PARAMETER NoInstallerBuild
  Never rebuild the installer, even when src-tauri changes. Useful on a
  machine without Rust, or to keep restarts quick.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/netra-x-host.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/netra-x-host.ps1 -Remote test -NoTunnel
#>
param(
    [int]$Port = 8000,
    [string]$Remote = "origin",
    [string]$Branch = "main",
    [int]$IntervalSeconds = 60,
    [switch]$NoTunnel,
    [switch]$NoInstallerBuild,
    [switch]$SkipInitialBuild,
    [string]$TunnelName = "netra-x",
    [string]$PublicHostname = "www.onnetra.in"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { $Python = "python" }
$Cloudflared = Join-Path $RepoRoot "tools\cloudflared.exe"

$script:ServerProcess = $null
$script:TunnelProcess = $null
$script:PublicUrl = $null
$TunnelLog = Join-Path $env:TEMP "netra-x-tunnel.log"

function Write-Section($text) {
    Write-Host ""
    Write-Host "=== $text " -ForegroundColor Cyan -NoNewline
    Write-Host ("=" * [Math]::Max(0, 60 - $text.Length)) -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Build steps
# ---------------------------------------------------------------------------

function Build-Web {
    Write-Host "[web] building UI..." -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot "apps\web")
    try {
        if (-not (Test-Path "node_modules")) { npm install }
        # No NEXT_PUBLIC_API_URL on purpose. The value is inlined at build
        # time, so any absolute address here would send every teammate's
        # browser to its own machine instead of to this server. The UI
        # resolves the API from the origin that served it.
        $env:NETRA_DESKTOP_BUILD = "1"
        Remove-Item Env:\NEXT_PUBLIC_API_URL -ErrorAction SilentlyContinue
        npm run build 2>&1 | Select-Object -Last 3
        Write-Host "[web] UI ready" -ForegroundColor Green
        return $true
    } catch {
        # A broken build must not take the running server down with it: the
        # previous export is still on disk and still being served.
        Write-Warning "[web] build failed, keeping the previous UI: $_"
        return $false
    } finally {
        Remove-Item Env:\NETRA_DESKTOP_BUILD -ErrorAction SilentlyContinue
        Pop-Location
    }
}

function Install-PythonDeps {
    Write-Host "[deps] installing Python dependencies..." -ForegroundColor Cyan
    try {
        & $Python -m pip install -q -e . 2>&1 | Select-Object -Last 3
        Write-Host "[deps] done" -ForegroundColor Green
    } catch {
        Write-Warning "[deps] install failed: $_"
    }
}

function Publish-Installer {
    if ($NoInstallerBuild) {
        Write-Warning "[exe] src-tauri changed but -NoInstallerBuild is set. Teammates keep the old app."
        return
    }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Warning "[exe] src-tauri changed but Rust/cargo is not installed. Cannot rebuild the installer."
        return
    }

    Write-Host "[exe] rebuilding installer (this takes a few minutes)..." -ForegroundColor Cyan
    try {
        # The tunnel address is what a fresh install should connect to, so
        # bake whatever this host is currently reachable at into the build.
        if ($script:PublicUrl) { $env:NETRAX_DEFAULT_SERVER = $script:PublicUrl }
        npm run desktop:build 2>&1 | Select-Object -Last 5

        $built = Get-ChildItem -Path (Join-Path $RepoRoot "src-tauri\target\release\bundle\nsis") `
            -Filter "*.exe" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $built) {
            Write-Warning "[exe] build produced no installer"
            return
        }

        # Publish it through the server itself. The alternative is messaging
        # a 2 MB file to everyone by hand every time the shell changes.
        $downloadDir = Join-Path $RepoRoot "apps\web\out\download"
        New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
        Copy-Item $built.FullName (Join-Path $downloadDir "NETRA-X-setup.exe") -Force
        Copy-Item $built.FullName (Join-Path $downloadDir $built.Name) -Force

        Write-Host "[exe] published: $($built.Name)" -ForegroundColor Green
        if ($script:PublicUrl) {
            Write-Host "[exe] teammates download: $script:PublicUrl/download/NETRA-X-setup.exe" -ForegroundColor Yellow
        }
    } catch {
        Write-Warning "[exe] installer build failed: $_"
    } finally {
        Remove-Item Env:\NETRAX_DEFAULT_SERVER -ErrorAction SilentlyContinue
    }
}

function Restore-Downloads {
    # `next build` recreates apps/web/out from scratch, deleting anything
    # dropped in beside it -- including a published installer.
    $stash = Join-Path $env:TEMP "netra-x-download-stash"
    $live = Join-Path $RepoRoot "apps\web\out\download"
    if (Test-Path $live) {
        New-Item -ItemType Directory -Force -Path $stash | Out-Null
        Copy-Item "$live\*" $stash -Force -ErrorAction SilentlyContinue
    } elseif (Test-Path $stash) {
        New-Item -ItemType Directory -Force -Path $live | Out-Null
        Copy-Item "$stash\*" $live -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Processes
# ---------------------------------------------------------------------------

function Invoke-Git {
    # git writes ordinary progress to stderr, and PowerShell 5.1 wraps native
    # stderr lines in ErrorRecords. Under $ErrorActionPreference = "Stop" that
    # throws on a perfectly successful command and killed the watch loop, so
    # the host stopped noticing changes while still looking healthy.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & git @args 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Test-ServerHealthy {
    # Ask the server whether it is serving, rather than asking Windows whether
    # a Process object looks alive. Start-Process -PassThru reported HasExited
    # with no ExitCode here and triggered endless false restarts.
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4 -UseBasicParsing
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Stop-Tree($process) {
    if ($process -and -not $process.HasExited) {
        & taskkill /PID $process.Id /T /F 2>&1 | Out-Null
    }
}

function Start-Server {
    Stop-Tree $script:ServerProcess
    # A lingering listener holds the port and the new process dies with
    # "only one usage of each socket address" -- which reads as a crash.
    $holders = netstat -ano | Select-String ":$Port\s.*LISTENING" | ForEach-Object {
        ($_ -split '\s+')[-1]
    } | Select-Object -Unique
    foreach ($holderPid in $holders) { & taskkill /PID $holderPid /T /F 2>&1 | Out-Null }

    $env:NETRAX_PORT = "$Port"
    Write-Host "[api] starting server on port $Port" -ForegroundColor Cyan
    $script:ServerProcess = Start-Process -FilePath $Python `
        -ArgumentList (Join-Path $RepoRoot "apps\api\server_main.py") `
        -PassThru -NoNewWindow
}

function Test-NamedTunnelReady {
    # `cloudflared tunnel create` writes one <tunnel-id>.json credentials file
    # per tunnel into ~/.cloudflared alongside cert.pem from the login step.
    # Its absence means either step was never done on this machine, and the
    # named tunnel command would fail outright rather than degrade -- so fall
    # back to a quick tunnel instead of erroring the whole host out.
    $cfHome = Join-Path $env:USERPROFILE ".cloudflared"
    if (-not (Test-Path (Join-Path $cfHome "cert.pem"))) { return $false }
    $list = & $Cloudflared tunnel list 2>$null
    return [bool]($list | Select-String -SimpleMatch $TunnelName)
}

function Start-Tunnel {
    if ($NoTunnel) { return }
    if (-not (Test-Path $Cloudflared)) {
        Write-Host "[tunnel] downloading cloudflared..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "tools") | Out-Null
        Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
            -OutFile $Cloudflared
    }

    Stop-Tree $script:TunnelProcess
    Remove-Item $TunnelLog -ErrorAction SilentlyContinue

    if ($TunnelName -and (Test-NamedTunnelReady)) {
        # A named tunnel has a fixed hostname (set up once via `tunnel create`
        # + `tunnel route dns`), so restarting this host, or the machine, never
        # changes the address teammates use -- unlike a quick tunnel, which
        # hands out a fresh random one on every launch.
        Write-Host "[tunnel] starting named tunnel '$TunnelName'" -ForegroundColor Cyan
        $script:TunnelProcess = Start-Process -FilePath $Cloudflared `
            -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port", "run", $TunnelName) `
            -PassThru -NoNewWindow -RedirectStandardError $TunnelLog

        Write-Host "[tunnel] waiting for connection..." -ForegroundColor Cyan
        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 2
            if ((Test-Path $TunnelLog) -and (Select-String -Path $TunnelLog -Pattern "Registered tunnel connection" -Quiet)) {
                $script:PublicUrl = "https://$PublicHostname"
                return
            }
        }
        Write-Warning "[tunnel] named tunnel did not connect within 30s. Falling back to a quick tunnel."
        Stop-Tree $script:TunnelProcess
    }

    Write-Host "[tunnel] starting quick tunnel (address changes on restart)" -ForegroundColor Yellow
    $script:TunnelProcess = Start-Process -FilePath $Cloudflared `
        -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port") `
        -PassThru -NoNewWindow -RedirectStandardError $TunnelLog

    Write-Host "[tunnel] waiting for a public address..." -ForegroundColor Cyan
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        if (-not (Test-Path $TunnelLog)) { continue }
        $match = Select-String -Path $TunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" |
            Select-Object -First 1
        if ($match) {
            $script:PublicUrl = $match.Matches[0].Value
            return
        }
    }
    Write-Warning "[tunnel] no address after 60s. Serving on the LAN only."
}

# ---------------------------------------------------------------------------
# Change detection
# ---------------------------------------------------------------------------

function Get-RemoteChanges {
    # Returns the list of changed paths, or $null when there is nothing new.
    # Offline or unreachable remote is not fatal: the server keeps serving and
    # the next poll tries again.
    Invoke-Git fetch --quiet $Remote $Branch | Out-Null

    $local = (Invoke-Git rev-parse HEAD) -join ""
    $upstream = (Invoke-Git rev-parse "$Remote/$Branch") -join ""
    if (-not $upstream -or $local -eq $upstream) { return $null }

    return @(Invoke-Git diff --name-only HEAD "$Remote/$Branch")
}

function Invoke-Deploy([string[]]$changedPaths, [string]$source) {
    Write-Section "Redeploying ($source)"
    $changedPaths | Select-Object -First 12 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    if ($changedPaths.Count -gt 12) {
        Write-Host "  ... and $($changedPaths.Count - 12) more" -ForegroundColor DarkGray
    }

    $webChanged = $changedPaths | Where-Object { $_ -like "apps/web/*" -and $_ -notlike "apps/web/out/*" }
    $pyChanged = $changedPaths | Where-Object { $_ -like "*.py" }
    $depsChanged = $changedPaths | Where-Object { $_ -like "pyproject.toml" -or $_ -like "requirements*.txt" }
    $shellChanged = $changedPaths | Where-Object { $_ -like "src-tauri/*" }

    if ($depsChanged) { Install-PythonDeps }
    if ($webChanged) { Restore-Downloads; Build-Web | Out-Null; Restore-Downloads }
    if ($pyChanged -or $depsChanged) { Start-Server }
    if ($shellChanged) { Publish-Installer }

    if (-not ($webChanged -or $pyChanged -or $depsChanged -or $shellChanged)) {
        Write-Host "  nothing that affects the running app" -ForegroundColor DarkGray
    }
    Write-Host "[deploy] done" -ForegroundColor Green
}

function Get-LocalStamp {
    $paths = @("apps\web\src", "apps\api", "packages", "workers", "seed")
    $parts = foreach ($rel in $paths) {
        $full = Join-Path $RepoRoot $rel
        if (-not (Test-Path $full)) { continue }
        Get-ChildItem -Path $full -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Extension -in @(".py", ".ts", ".tsx", ".css") -and
                $_.FullName -notmatch '\\(node_modules|__pycache__|\.next)\\'
            } | ForEach-Object { "$($_.FullName)|$($_.LastWriteTimeUtc.Ticks)" }
    }
    ($parts | Sort-Object) -join "`n"
}

# ---------------------------------------------------------------------------
# Start up
# ---------------------------------------------------------------------------

Write-Section "NETRA-X host starting"
Restore-Downloads
if (-not $SkipInitialBuild) {
    Build-Web | Out-Null
    Restore-Downloads
} else {
    Write-Host "[web] reusing the existing UI export" -ForegroundColor DarkGray
}
Start-Server
Start-Tunnel

$lanUrl = "http://$((Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -eq 'Wi-Fi' } |
    Select-Object -First 1 -ExpandProperty IPAddress)):$Port"

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host " NETRA-X is running" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
if ($script:PublicUrl) {
    Write-Host "  Anywhere : $script:PublicUrl" -ForegroundColor Yellow
}
Write-Host "  This WiFi: $lanUrl"
Write-Host "  Here     : http://127.0.0.1:$Port"
Write-Host ""
Write-Host "  Watching $Remote/$Branch every ${IntervalSeconds}s, and local edits."
Write-Host "  Ctrl+C to stop everything."
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""

$localStamp = Get-LocalStamp
$lastRemoteCheck = Get-Date

$script:UnhealthyChecks = 0

try {
    while ($true) {
        Start-Sleep -Seconds 3
        try {

        # Local edits: same rules, no commit required.
        $nowStamp = Get-LocalStamp
        if ($nowStamp -ne $localStamp) {
            $changed = @(Invoke-Git status --porcelain | ForEach-Object {
                $line = "$_".Trim()
                if ($line) { ($line -split '\s+', 2)[-1] }
            })
            Invoke-Deploy $changed "local edits"
            $localStamp = Get-LocalStamp
        }

        # GitHub, on the interval.
        if (((Get-Date) - $lastRemoteCheck).TotalSeconds -ge $IntervalSeconds) {
            $lastRemoteCheck = Get-Date
            $remoteChanges = Get-RemoteChanges
            if ($remoteChanges) {
                Write-Host "[git] $($remoteChanges.Count) file(s) changed on $Remote/$Branch" -ForegroundColor Yellow
                try {
                    # --ff-only refuses rather than creating a merge commit
                    # nobody asked for. A diverged branch needs a human.
                    & git merge --ff-only "$Remote/$Branch" 2>&1 | Out-Null
                    Invoke-Deploy $remoteChanges "$Remote/$Branch"
                    $localStamp = Get-LocalStamp
                } catch {
                    Write-Warning "[git] cannot fast-forward -- local commits have diverged. Resolve by hand."
                }
            }
        }

        # A crashed server should be visible and recovered, not mistaken for a
        # network problem by everyone using it. Two consecutive failures, so a
        # restart in progress is not itself reported as a crash.
        if (-not (Test-ServerHealthy)) {
            $script:UnhealthyChecks++
            if ($script:UnhealthyChecks -ge 2) {
                Write-Warning "[api] server is not responding. Restarting..."
                Start-Server
                $script:UnhealthyChecks = 0
            }
        } else {
            $script:UnhealthyChecks = 0
        }

        if (-not $NoTunnel -and $script:TunnelProcess -and $script:TunnelProcess.HasExited) {
            Write-Warning "[tunnel] tunnel died. Reconnecting..."
            $previous = $script:PublicUrl
            Start-Tunnel
            if ($script:PublicUrl -and $script:PublicUrl -ne $previous) {
                # Quick tunnels get a new random name each time, so anyone
                # with the old address -- including installers built with it
                # baked in -- must be told the new one.
                Write-Host ""
                Write-Warning "NEW PUBLIC ADDRESS: $script:PublicUrl"
                Write-Warning "The previous address no longer works. Send this one to your team."
                Write-Host ""
            }
        }
        } catch {
            # One bad iteration -- a git hiccup, a file locked mid-save -- must
            # not take down a server other people are using.
            Write-Warning "[host] $_"
        }
    }
} finally {
    Write-Host "`nShutting down..." -ForegroundColor DarkGray
    Stop-Tree $script:ServerProcess
    Stop-Tree $script:TunnelProcess
}
