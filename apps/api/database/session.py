"""
Database Session Management for NETRA-X Backend
Supports PostgreSQL asyncpg / psycopg2 and SQLite fallback for local standalone testing.
"""

import os
from typing import AsyncGenerator
from sqlalchemy import create_engine, event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from .models import Base

# Default to SQLite fallback if Postgres is not configured locally
DEFAULT_DB_URL = "sqlite+aiosqlite:///./netrax.db"
DEFAULT_DB_URL_SYNC = "sqlite:///./netrax.db"

# Normalize environment DB URLs (Render provides postgres:// or postgresql://)
raw_db_url = os.getenv("DATABASE_URL", DEFAULT_DB_URL)

if raw_db_url.startswith("postgres://"):
    DATABASE_URL = raw_db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    raw_sync_default = raw_db_url.replace("postgres://", "postgresql://", 1)
elif raw_db_url.startswith("postgresql://") and not raw_db_url.startswith("postgresql+asyncpg://"):
    DATABASE_URL = raw_db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    raw_sync_default = raw_db_url
else:
    DATABASE_URL = raw_db_url
    raw_sync_default = DEFAULT_DB_URL_SYNC

DATABASE_URL_SYNC = os.getenv("DATABASE_URL_SYNC", raw_sync_default)

# If PostgreSQL requested but psycopg2 missing or offline, fall back to SQLite
if "postgresql" in DATABASE_URL_SYNC or "postgres" in DATABASE_URL_SYNC:
    try:
        import psycopg2
    except ImportError:
        DATABASE_URL = "sqlite+aiosqlite:///./netrax.db"
        DATABASE_URL_SYNC = "sqlite:///./netrax.db"

def apply_sqlite_pragmas(engine) -> None:
    """Make a SQLite engine safe for several people working at once.

    SQLite's default rollback journal locks the whole database for each write
    and readers block on it, so simultaneous analysts hit intermittent
    "database is locked" errors. Three pragmas, set per connection because
    busy_timeout is a connection property and does not persist:

      journal_mode=WAL   readers proceed during a write (persists in the file)
      busy_timeout       wait for a held lock instead of failing at once
      synchronous=NORMAL the durability WAL is designed for; FULL fsyncs every
                         commit, which is needless here and much slower

    Accepts a sync or async engine -- an async engine wraps a sync one, and the
    connect event lives on the inner engine.
    """
    target = getattr(engine, "sync_engine", engine)

    @event.listens_for(target, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=10000")
            cursor.execute("PRAGMA synchronous=NORMAL")
        finally:
            cursor.close()


if "sqlite" in DATABASE_URL_SYNC:
    async_engine = create_async_engine(DATABASE_URL, echo=False)
    sync_engine = create_engine(DATABASE_URL_SYNC, echo=False, connect_args={"check_same_thread": False})
    apply_sqlite_pragmas(async_engine)
    apply_sqlite_pragmas(sync_engine)
else:
    async_engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
    sync_engine = create_engine(DATABASE_URL_SYNC, echo=False, pool_pre_ping=True)

AsyncSessionLocal = sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False
)

SyncSessionLocal = sessionmaker(
    bind=sync_engine,
    autocommit=False,
    autoflush=False
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


def init_db_sync():
    """Synchronous DB table creation for seed/testing."""
    Base.metadata.create_all(bind=sync_engine)

    # create_all adds missing tables but never a missing column, so a model
    # gaining a field left every existing database broken until it was deleted.
    from apps.api.database.migrate import apply as apply_migrations

    applied = apply_migrations(sync_engine)
    if applied:
        print(f"[+] Applied additive migrations: {', '.join(applied)}")
