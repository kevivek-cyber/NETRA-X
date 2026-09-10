"""
Shared-server mode: one machine serves several analysts at once.

SQLite's default rollback journal takes a database-wide lock for every write
and readers block on it. With a single desktop user that is invisible; with
six people working simultaneously it surfaces as intermittent
`database is locked` OperationalErrors that look random and lose work.

WAL lets readers proceed during a write, and busy_timeout makes a writer wait
its turn instead of failing immediately.
"""
import os
import threading

import pytest
from sqlalchemy import create_engine, text

from apps.api.database.session import apply_sqlite_pragmas, sync_engine


@pytest.fixture()
def temp_engine(tmp_path):
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'concurrency.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    apply_sqlite_pragmas(engine)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE t (id INTEGER PRIMARY KEY, who TEXT)"))
    return engine


def test_wal_and_busy_timeout_are_set(temp_engine):
    with temp_engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar().lower() == "wal"
        assert conn.exec_driver_sql("PRAGMA busy_timeout").scalar() >= 5000


def test_the_application_engine_is_configured_too():
    """The pragmas must apply to the engine the app actually uses."""
    if "sqlite" not in str(sync_engine.url):
        pytest.skip("configured for PostgreSQL; SQLite pragmas do not apply")
    with sync_engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar().lower() == "wal"


def test_six_concurrent_writers_all_succeed(temp_engine):
    """Six analysts writing at once -- nobody gets 'database is locked'."""
    errors = []
    barrier = threading.Barrier(6)

    def writer(n):
        try:
            barrier.wait()  # maximise contention
            for i in range(20):
                with temp_engine.begin() as conn:
                    conn.execute(
                        text("INSERT INTO t (who) VALUES (:w)"), {"w": f"analyst{n}-{i}"}
                    )
        except Exception as exc:  # noqa: BLE001 - the failure mode under test
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(n,)) for n in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"concurrent writes failed: {errors[:3]}"
    with temp_engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT COUNT(*) FROM t").scalar() == 120


# ---------------------------------------------------------------------------
# LAN server entrypoint
# ---------------------------------------------------------------------------
#
# The desktop launcher binds 127.0.0.1, which is deliberately unreachable from
# other machines. Serving teammates needs a bind on every interface and a URL
# the others can actually type.

from apps.api import server_main


def test_binds_all_interfaces_by_default():
    """127.0.0.1 would be invisible to every other laptop on the WiFi."""
    assert server_main.resolve_host() == "0.0.0.0"


def test_port_is_overridable(monkeypatch):
    assert server_main.resolve_port() == 8000
    monkeypatch.setenv("NETRAX_PORT", "9001")
    assert server_main.resolve_port() == 9001


def test_lan_urls_are_shareable():
    """Teammates need a real address; loopback and link-local are not one."""
    urls = server_main.lan_urls(port=8000)
    assert all(u.startswith("http://") and u.endswith(":8000") for u in urls)
    assert not any("127.0.0.1" in u or "0.0.0.0" in u for u in urls)
    assert not any("169.254." in u for u in urls)


def test_primary_url_is_the_routable_interface():
    """A laptop has several IPv4 addresses and only one is the WiFi.

    Virtualisation adapters (VirtualBox's 192.168.56.x, WSL, Hyper-V) look
    exactly like LAN addresses. Handing a teammate one of those produces a
    connection that never establishes, so the address the routing table would
    actually use must be named first.
    """
    primary = server_main.primary_lan_url(port=8000)
    if primary is None:
        pytest.skip("no network")
    assert primary in server_main.lan_urls(port=8000)


def test_secret_key_persists_across_restarts(tmp_path, monkeypatch):
    """Sessions must survive a restart, or every analyst is logged out.

    An ephemeral key is right for a single-user desktop app and wrong for a
    shared server: restarting invalidates every teammate's token at once.
    """
    monkeypatch.delenv("SECRET_KEY", raising=False)
    first = server_main.ensure_persistent_secret(tmp_path)
    second = server_main.ensure_persistent_secret(tmp_path)
    assert first == second
    assert len(first) >= 32
    assert os.environ["SECRET_KEY"] == first


def test_existing_secret_key_is_respected(tmp_path, monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "operator-supplied-key-value-32-chars")
    assert server_main.ensure_persistent_secret(tmp_path) == "operator-supplied-key-value-32-chars"
    assert not (tmp_path / "secret.key").exists()
