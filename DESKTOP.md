# NETRA-X Desktop (local-first, Tauri)

A packaged Windows desktop app that runs the whole NETRA-X stack **on your
own machine** — no Render, no Docker, no external Postgres/Neo4j/Redis. The
web UI is unchanged; it just talks to a FastAPI backend that Tauri starts
and stops for you, on `127.0.0.1:8000`.

This is fully additive: `render.yaml`, `docker-compose.yml`, and the normal
cloud deploy flow in [DEPLOYMENT.md](DEPLOYMENT.md) are untouched. Use
whichever fits — the desktop app for fast, fully-offline daily use; Render/
Docker if you want a shared/cloud-hosted instance.

## Why this works with (almost) no backend changes

- **Database**: [apps/api/database/session.py](apps/api/database/session.py)
  already defaults to SQLite and only switches to Postgres if `DATABASE_URL`
  is set *and* `psycopg2` is importable. The desktop launcher
  ([apps/api/desktop_main.py](apps/api/desktop_main.py)) pins SQLite at
  `%APPDATA%\NETRA-X\netrax.db` (Windows) so the ledger survives reinstalls
  and isn't written inside the (often read-only) install directory.
- **Neo4j**: [packages/graph/projection.py](packages/graph/projection.py)
  already catches connection failures and falls back to relational topology
  with a cooldown, so simply never setting `NEO4J_URI` (which the desktop
  launcher enforces) keeps it permanently — and gracefully — in fallback
  mode.
- **Redis / MinIO**: only touched by the separate collection worker
  ([workers/collection/event_bus.py](workers/collection/event_bus.py)),
  which the desktop app doesn't start.
- **Frontend**: [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts) already
  defaults its API base URL to `http://localhost:8000` unless the page is
  served from an `onrender.com` host — so the exact same static build works
  whether it's opened in a browser locally or shown inside the Tauri window.

## Architecture

```
Tauri window (native, shows apps/web/out — a static Next.js export)
        │  fetch() calls to http://127.0.0.1:8000
        ▼
Bundled embeddable CPython  →  apps/api/desktop_main.py  →  uvicorn (apps.api.main:app)
        │
        ▼
SQLite at %APPDATA%\NETRA-X\netrax.db
```

`src-tauri/src/main.rs` spawns the Python process on window startup and
kills it when the app exits — nothing is left running in the background.

## Prerequisites (build machine only — not needed by end users)

- Rust + Cargo (`rustup`) — https://www.rust-lang.org/tools/install
- Node.js 18+ (already required for `apps/web`)
- Internet access for the *first* build (downloads a portable CPython
  runtime, cached afterward under `src-tauri/resources/pyembed`)

```bash
npm install                 # installs @tauri-apps/cli at the repo root
npm run desktop:dev          # dev mode: live-reloads the Next.js app + local API
npm run desktop:build        # produces an installable .exe/.msi under src-tauri/target/release/bundle
```

`desktop:build` runs [scripts/build-desktop.ps1](scripts/build-desktop.ps1)
first (wired as Tauri's `beforeBuildCommand`), which:

1. Builds the static frontend (`apps/web/out`) with `NETRA_DESKTOP_BUILD=1`.
2. Downloads a pinned python-build-standalone CPython 3.11 build and
   `pip install`s [requirements-desktop.txt](requirements-desktop.txt) into
   it — this is a portable runtime, not a PyInstaller freeze, so the
   spaCy/scikit-learn/numpy/faststylometry stack installs the normal way
   instead of fighting a bundler.
3. Copies `apps/`, `packages/`, `seed/` into `src-tauri/resources/app`,
   which is what `desktop_main.py` actually runs against once installed.

## Running from a terminal without the GUI shell

If you don't want the packaged app, the existing local workflow in the main
[README](README.md#-how-to-run) still works unchanged — or use the same
desktop-mode launcher directly for the SQLite-only, service-free behavior:

```bash
python apps/api/desktop_main.py       # API on 127.0.0.1:8000, SQLite in %APPDATA%
cd apps/web && npm run dev            # UI on localhost:3000
```

## Known limitations (v1)

- Windows-only packaging is set up (`nsis`/`msi` targets in
  `src-tauri/tauri.conf.json`); macOS/Linux bundling would need real
  `.icns`/Linux icon assets (placeholders are currently generated from a
  simple PNG) and a matching CPython download URL for that platform.
- The API always binds to port 8000; if something else on the machine is
  already using it, the desktop app's health check will time out. There's
  no dynamic-port negotiation yet.
- App icons in `src-tauri/icons/` are generated placeholders — swap them
  for real branding art before a public release.
