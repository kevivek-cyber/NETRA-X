<#
.SYNOPSIS
  Prepares everything the Tauri desktop build needs that isn't Rust/Node:
    1. Builds the static Next.js export (apps/web/out).
    2. Downloads a portable, embeddable CPython (python-build-standalone) and
       pip-installs NETRA-X's backend dependencies into it -- this avoids
       PyInstaller-freezing the scientific stack (spaCy/scikit-learn/numpy/
       faststylometry), which is fragile and slow to iterate on.
    3. Copies the backend source tree (apps/api, packages, seed) into
       src-tauri/resources/app, which desktop_main.py runs from at runtime.

  Run via `npm run tauri build` (wired as `beforeBuildCommand` in
  src-tauri/tauri.conf.json) or directly: `powershell -File scripts/build-desktop.ps1`.

  Requires internet access (first run only -- the Python runtime is cached
  under src-tauri/resources/pyembed and skipped on subsequent runs unless
  -Force is passed).
#>
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Resources = Join-Path $RepoRoot "src-tauri\resources"
$PyEmbedDir = Join-Path $Resources "pyembed"
$AppDir = Join-Path $Resources "app"

# Pin an exact python-build-standalone release so builds are reproducible.
# If this URL 404s (release pruned/renamed upstream), check
# https://github.com/astral-sh/python-build-standalone/releases for a
# current "cpython-3.11.*-x86_64-pc-windows-msvc-install_only.tar.gz" asset
# and update this constant.
$PyStandaloneUrl = "https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.11.16+20260901-x86_64-pc-windows-msvc-install_only.tar.gz"

Write-Host "==> [1/3] Building static frontend export (apps/web/out)"
Push-Location (Join-Path $RepoRoot "apps\web")
try {
    if (-not (Test-Path "node_modules")) {
        npm install
    }
    $env:NETRA_DESKTOP_BUILD = "1"
    $env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:8000"
    npm run build
} finally {
    Remove-Item Env:\NETRA_DESKTOP_BUILD -ErrorAction SilentlyContinue
    Pop-Location
}

Write-Host "==> [2/3] Preparing embedded Python runtime"
if ($Force -and (Test-Path $PyEmbedDir)) {
    Remove-Item -Recurse -Force $PyEmbedDir
}
if (-not (Test-Path $PyEmbedDir)) {
    New-Item -ItemType Directory -Force -Path $Resources | Out-Null
    $tarball = Join-Path $env:TEMP "netra-x-cpython.tar.gz"
    Write-Host "    Downloading $PyStandaloneUrl"
    Invoke-WebRequest -Uri $PyStandaloneUrl -OutFile $tarball
    $extractRoot = Join-Path $env:TEMP "netra-x-cpython-extract"
    if (Test-Path $extractRoot) { Remove-Item -Recurse -Force $extractRoot }
    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
    # If Git for Windows' usr/bin is ahead of System32 on PATH, plain `tar`
    # resolves to MSYS bsdtar/GNU tar, which parses a bare `C:\...` argument
    # to -C as a "host:path" remote spec (SSH-style) instead of a local
    # Windows path and fails with "Cannot connect to C: resolve failed".
    # Call Windows' own bsdtar explicitly and pass a relative -C target from
    # inside the extract dir to sidestep the ambiguity entirely.
    $winTar = Join-Path $env:WINDIR "System32\tar.exe"
    if (-not (Test-Path $winTar)) { $winTar = "tar" }
    Push-Location $extractRoot
    try {
        & $winTar -xzf $tarball
    } finally {
        Pop-Location
    }
    # The archive's top-level dir is "python/"; move it into place as pyembed.
    Move-Item (Join-Path $extractRoot "python") $PyEmbedDir
    Remove-Item $tarball -Force
    Remove-Item -Recurse -Force $extractRoot

    Write-Host "    Installing backend dependencies into the embedded runtime"
    $pyExe = Join-Path $PyEmbedDir "python.exe"
    & $pyExe -m pip install --no-cache-dir --upgrade pip
    & $pyExe -m pip install --no-cache-dir -r (Join-Path $RepoRoot "requirements-desktop.txt")
} else {
    Write-Host "    Found existing $PyEmbedDir (pass -Force to rebuild)"
}

Write-Host "==> [3/3] Copying backend source into resources/app"
if (Test-Path $AppDir) {
    Remove-Item -Recurse -Force $AppDir
}
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
foreach ($dir in @("apps", "packages", "seed")) {
    Copy-Item -Recurse -Force -Path (Join-Path $RepoRoot $dir) -Destination (Join-Path $AppDir $dir) `
        -Exclude "__pycache__"
}
# Strip caches/bytecode/dev artifacts that don't belong in the shipped app.
Get-ChildItem -Path $AppDir -Recurse -Directory -Filter "__pycache__" |
    ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
Get-ChildItem -Path $AppDir -Recurse -Directory -Filter "node_modules" |
    ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
# apps/web isn't needed inside the backend resource bundle -- the static
# export is served by the webview directly via distDir, not by this copy.
Remove-Item -Recurse -Force (Join-Path $AppDir "apps\web") -ErrorAction SilentlyContinue

Write-Host "==> Desktop build inputs ready."
