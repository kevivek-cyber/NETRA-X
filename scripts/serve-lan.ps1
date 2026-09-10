<#
.SYNOPSIS
  Run this laptop as the shared NETRA-X server for the team.

  Serves the API and the web UI from one process on every network interface,
  so teammates on the same WiFi open the printed URL and work against one
  shared database.

.DESCRIPTION
  Three things have to be true for a teammate's laptop to connect, and this
  script handles or checks each:

    1. The UI export exists (apps/web/out) -- the API serves it from the same
       origin, which is what removes the CORS and API-URL configuration that
       the two-service setup needed.
    2. The server binds 0.0.0.0, not 127.0.0.1.
    3. Windows Firewall allows inbound TCP on the port. This is the usual
       cause of "it works on your machine only": the server is running and
       correct, and the packets are dropped before reaching it.

.PARAMETER Port
  Port to listen on. Default 8000.

.PARAMETER SkipBuild
  Reuse the existing apps/web/out instead of rebuilding the UI.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/serve-lan.ps1
#>
param(
    [int]$Port = 8000,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

# --- 1. UI export ---------------------------------------------------------
$outDir = Join-Path $RepoRoot "apps\web\out"
# A desktop build bakes http://127.0.0.1:8000 into the bundle, because
# NEXT_PUBLIC_* is inlined at build time. Serving that export to the team
# points every teammate's browser at its own machine, where nothing is
# listening -- the page loads and only login fails, which reads as a server
# problem rather than a stale build. Detect it and rebuild regardless of
# -SkipBuild.
$staleDesktopBuild = $false
if (Test-Path $outDir) {
    $staleDesktopBuild = [bool](
        Get-ChildItem -Path $outDir -Recurse -Filter *.js -ErrorAction SilentlyContinue |
        Select-String -Pattern "127\.0\.0\.1:8000" -SimpleMatch -List -ErrorAction SilentlyContinue
    )
}

if ($SkipBuild -and $staleDesktopBuild) {
    Write-Warning "The existing UI export has a desktop API address compiled in."
    Write-Warning "Rebuilding despite -SkipBuild; teammates could not log in otherwise."
}

if ($SkipBuild -and (Test-Path $outDir) -and -not $staleDesktopBuild) {
    Write-Host "==> [1/3] Reusing existing UI export" -ForegroundColor DarkGray
} else {
    Write-Host "==> [1/3] Building the web UI" -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot "apps\web")
    try {
        if (-not (Test-Path "node_modules")) { npm install }
        # Same-origin: the UI calls /api/v1/... relative to whatever host it
        # was served from, so one build works for every teammate regardless of
        # this machine's IP. Baking an absolute URL in would break the moment
        # the laptop's address changed.
        $env:NETRA_DESKTOP_BUILD = "1"
        Remove-Item Env:\NEXT_PUBLIC_API_URL -ErrorAction SilentlyContinue
        npm run build
    } finally {
        Remove-Item Env:\NETRA_DESKTOP_BUILD -ErrorAction SilentlyContinue
        Pop-Location
    }
}

# --- 2. Firewall ----------------------------------------------------------
Write-Host "==> [2/3] Checking Windows Firewall" -ForegroundColor Cyan
$ruleName = "NETRA-X shared server ($Port)"
# A rule scoped to the Private profile does nothing while Windows classifies
# the current network as Public -- the rule is added, reports success, and
# teammates still time out. Check the profile before trusting the rule.
$publicNets = @(Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' })
if ($publicNets) {
    foreach ($net in $publicNets) {
        Write-Warning "Network '$($net.Name)' ($($net.InterfaceAlias)) is classified Public."
    }
    Write-Warning "A Private-profile rule will NOT apply, so teammates will see"
    Write-Warning "ERR_CONNECTION_TIMED_OUT. From an Administrator PowerShell, mark your"
    Write-Warning "own WiFi as trusted:"
    Write-Warning "  Set-NetConnectionProfile -Name '$($publicNets[0].Name)' -NetworkCategory Private"
}

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "    Rule already present." -ForegroundColor DarkGray
} else {
    $isAdmin = ([Security.Principal.WindowsPrincipal] `
        [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if ($isAdmin) {
        # Private profile only: this opens the port to the local network, not
        # to public WiFi the laptop may join later.
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound `
            -Action Allow -Protocol TCP -LocalPort $Port -Profile Private | Out-Null
        Write-Host "    Allowed inbound TCP $Port on private networks." -ForegroundColor Green
    } else {
        Write-Warning "Not running as Administrator, so the firewall rule was not added."
        Write-Warning "Teammates will get 'connection refused' until you either run this"
        Write-Warning "script once from an admin PowerShell, or run:"
        Write-Warning "  New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound ``"
        Write-Warning "    -Action Allow -Protocol TCP -LocalPort $Port -Profile Private"
    }
}

# --- 3. Serve -------------------------------------------------------------
Write-Host "==> [3/3] Starting the shared server" -ForegroundColor Cyan
$env:NETRAX_PORT = "$Port"
& $python (Join-Path $RepoRoot "apps\api\server_main.py")
