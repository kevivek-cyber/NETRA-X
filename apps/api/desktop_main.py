"""
NETRA-X Desktop Launcher
========================
Entry point used by the packaged Tauri desktop app (and by anyone who wants
to run NETRA-X fully offline from a terminal without Docker/Postgres/Neo4j).

It does three things `python -m uvicorn apps.api.main:app` doesn't:

1. Forces the SQLite database into a per-user app-data directory instead of
   the current working directory, so the installed app doesn't try to write
   next to itself (Program Files is typically not writable) and each OS user
   gets their own ledger.
2. Makes sure NEO4J_URI / REDIS_URL / MinIO settings are unset so the graph
   projection and collection event-bus paths stay in their existing,
   already-graceful "service unavailable" fallback modes (see
   packages/graph/projection.py) instead of trying to reach localhost ports
   nothing is listening on.
3. Starts uvicorn on 127.0.0.1:8000 -- the same host/port apps/web/src/lib/api.ts
   already defaults to, so the statically-exported frontend needs no runtime
   configuration to find it.

Usage:
    python apps/api/desktop_main.py
"""
import os
import sys
from pathlib import Path

# When launched by the Tauri shell, this file is run directly
# (`python .../apps/api/desktop_main.py`), which puts only its own directory
# (apps/api/) on sys.path -- not the project root. `apps.api.main` and
# `packages.*` would then fail to import. Insert the project root (two
# levels up from this file) explicitly so it works the same whether run from
# the repo (`python apps/api/desktop_main.py`) or from the bundled
# resources/app copy inside an installed desktop build.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


def _app_data_dir() -> Path:
    """Per-user, per-OS writable directory for the desktop database."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = str(Path.home() / "Library" / "Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    data_dir = Path(base) / "NETRA-X"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def main() -> None:
    data_dir = _app_data_dir()
    db_path = data_dir / "netrax.db"

    # Force the SQLite fallback used by apps/api/database/session.py -- never
    # let a stray DATABASE_URL from the environment point the desktop app at
    # a Postgres instance that isn't there.
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path.as_posix()}"
    os.environ["DATABASE_URL_SYNC"] = f"sqlite:///{db_path.as_posix()}"

    # Never attempt to reach graph/cache/object-storage services that the
    # desktop app doesn't run. Clearing these (rather than leaving whatever
    # the user's shell happens to have set) keeps behavior deterministic.
    for var in ("NEO4J_URI", "REDIS_URL", "REDIS_HOST", "MINIO_ENDPOINT"):
        os.environ.pop(var, None)

    os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,tauri://localhost")

    print(f"[NETRA-X Desktop] Database: {db_path}")
    print("[NETRA-X Desktop] Starting API on http://127.0.0.1:8000 (Neo4j/Redis/MinIO disabled -- relational fallback mode)")

    import uvicorn

    uvicorn.run("apps.api.main:app", host="127.0.0.1", port=8000, reload=False, log_level="info")


if __name__ == "__main__":
    main()
