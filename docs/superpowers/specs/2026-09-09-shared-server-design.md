# NETRA-X Shared Server — Design

**Date:** 2026-09-09
**Status:** Approved in chat, pending implementation

## Goal

Six teammates use NETRA-X at the same time, against one shared set of data,
from an installed desktop application. One machine is the server. Changes made
by any member are visible to all. Code updates reach everyone without
redistributing an installer.

## Problem with the current build

Each install is a self-contained island: the Tauri shell spawns a bundled
CPython running the full API against a private SQLite file in `%APPDATA%`.
Nothing is shared. Six installs mean six unrelated databases, and every code
change means re-sending a 119 MB installer to five people.

## Architecture

    Server box (one machine, always on, on the WiFi)
      FastAPI on 0.0.0.0:8000
        ├── /api/v1/...   REST API
        ├── /api/v1/events  SSE stream (new)
        └── /*            the exported Next.js UI  [already implemented]
      PostgreSQL or SQLite+WAL — the single source of truth

    Client laptops (five)
      NETRA-X.exe — a thin native shell, a few MB, NO Python, NO database
        first run: prompt for server address, persist it
        then: load the server's URL in the webview

The client ships no application code beyond the shell. The UI is served by the
server, so a `git pull` + restart on the server updates everyone at once. The
installer is redistributed only when the Rust shell itself changes, which is
rare.

Because the UI is served by the server, the webview is same-origin with the
API. The CORS failure class that broke desktop login cannot recur.

## Components

### 1. Server mode

- Bind `0.0.0.0` (currently `127.0.0.1`, which is unreachable from the LAN).
- SQLite: enable WAL and a busy timeout, or run PostgreSQL. Without WAL,
  concurrent writes surface as intermittent `database is locked` errors.
  `session.py` already supports PostgreSQL via `DATABASE_URL`.
- A `scripts/serve.ps1` deploy path: pull, build the UI export, restart.

The audit chain needs no change. `seq` is UNIQUE and `append_audit_event`
retries on collision, so concurrent writers cannot fork the chain.

### 2. Thin client shell

- Remove the sidecar spawn and the pyembed/app resources from the bundle.
- First-run screen collecting the server address; persist locally.
- Verify the address by calling `/health` and checking the response is
  NETRA-X's own, not merely that a port answers.
- On failure show a real dialog naming the cause. Today both failure paths are
  silent: `eprintln!` writes to a console that does not exist, and the return
  value of `wait_for_api` is discarded.

### 3. Live updates

- `GET /api/v1/events` — Server-Sent Events, authenticated.
- Publish on mutation: evidence created/deleted, hypothesis reviewed, case
  created/archived, identifiers changed.
- The UI subscribes and refetches the affected view.

SSE over WebSocket: the traffic is one-directional, browsers reconnect
automatically, and it needs no new dependency.

## Explicitly out of scope

- **Edit conflicts.** Two people reviewing one hypothesis: last write wins,
  silently. Acceptable for six teammates in a room; revisit if it bites.
- **Off-network access.** The server address is configuration, so a Cloudflare
  Tunnel hostname works later with no code change.
- **Peer-to-peer sync.** Rejected: conflict resolution across an append-only
  ledger and a hash-chained audit log is weeks of work.

## Risks

- The server box is a single point of failure. If it sleeps, everyone stops.
  Disable sleep on it.
- The server's LAN IP can change on DHCP lease renewal, breaking every saved
  client address. Use a static IP or a DHCP reservation.
- Port 8000 must be open in the server's Windows Firewall for the LAN.
