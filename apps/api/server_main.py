"""
NETRA-X Server Launcher (shared LAN mode)
=========================================
Runs the machine that several analysts share. Where `desktop_main.py` starts a
private backend for one person on 127.0.0.1, this binds every interface so the
other laptops on the WiFi can reach it, and serves the exported web UI from
the same process -- so clients are same-origin with the API and need no build
of their own.

    python apps/api/server_main.py

Prints the URLs teammates should use. The database is the shared source of
truth for everyone, kept in the per-user app-data directory rather than beside
the code, so it survives a `git pull` and a reinstall.
"""
import os
import secrets
import socket
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from apps.api.desktop_main import _app_data_dir  # noqa: E402  (path set above)

DEFAULT_PORT = 8000


def resolve_host() -> str:
    """Bind address. Every interface, so the LAN can reach this.

    Overridable, but the default must not be loopback: 127.0.0.1 accepts only
    connections from this machine, which is exactly the failure teammates
    would report as "the server is down".
    """
    return os.getenv("NETRAX_HOST", "0.0.0.0")


def resolve_port() -> int:
    raw = os.getenv("NETRAX_PORT", str(DEFAULT_PORT))
    try:
        return int(raw)
    except ValueError:
        print(f"[!] NETRAX_PORT={raw!r} is not a number; using {DEFAULT_PORT}")
        return DEFAULT_PORT


def lan_urls(port: int) -> list[str]:
    """Addresses teammates can actually type.

    Filters what would waste their time: loopback reaches only this machine,
    and 169.254.x.x is the address Windows self-assigns when DHCP failed --
    present on disconnected adapters and never routable.
    """
    addresses = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(info[4][0])
    except socket.gaierror:
        pass

    # getaddrinfo can miss the active adapter; ask the routing table which
    # local address would be used to reach the network. No packets are sent.
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("8.8.8.8", 80))
            addresses.add(probe.getsockname()[0])
        finally:
            probe.close()
    except OSError:
        pass

    usable = sorted(
        a for a in addresses
        if not a.startswith("127.") and not a.startswith("169.254.") and a != "0.0.0.0"
    )
    return [f"http://{a}:{port}" for a in usable]


def _routable_address() -> str | None:
    """The local address the OS would use to reach the network.

    Asks the routing table by opening a UDP socket, which assigns a local
    address without sending anything. This is what distinguishes the real WiFi
    adapter from virtualisation adapters (VirtualBox 192.168.56.x, WSL,
    Hyper-V) that are indistinguishable by address alone.
    """
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("8.8.8.8", 80))
            return probe.getsockname()[0]
        finally:
            probe.close()
    except OSError:
        return None


def primary_lan_url(port: int) -> str | None:
    """The one address to give teammates, or None if offline."""
    address = _routable_address()
    return f"http://{address}:{port}" if address else None


def ensure_persistent_secret(data_dir: Path) -> str:
    """A JWT signing key that survives a restart.

    The app generates a random key per process when SECRET_KEY is unset. For
    one desktop user that is a good default -- tokens cannot outlive the
    session. For a shared server it means every restart silently logs out the
    whole team. Persist one instead, and leave an operator-supplied
    SECRET_KEY untouched.
    """
    existing = os.getenv("SECRET_KEY")
    if existing:
        return existing

    key_file = data_dir / "secret.key"
    if key_file.exists():
        key = key_file.read_text(encoding="utf-8").strip()
    else:
        key = secrets.token_urlsafe(48)
        data_dir.mkdir(parents=True, exist_ok=True)
        key_file.write_text(key, encoding="utf-8")
        try:
            os.chmod(key_file, 0o600)
        except OSError:
            pass  # best effort; Windows ACLs are not POSIX modes

    os.environ["SECRET_KEY"] = key
    return key


def main() -> None:
    data_dir = _app_data_dir()
    db_path = data_dir / "netrax.db"

    ensure_persistent_secret(data_dir)

    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path.as_posix()}"
    os.environ["DATABASE_URL_SYNC"] = f"sqlite:///{db_path.as_posix()}"

    # Same rationale as the desktop launcher: these services are not run here,
    # and their absence is handled gracefully only when nothing points at them.
    for var in ("NEO4J_URI", "REDIS_URL", "REDIS_HOST", "MINIO_ENDPOINT"):
        os.environ.pop(var, None)

    host, port = resolve_host(), resolve_port()

    print("=" * 68)
    print(" NETRA-X — shared server")
    print("=" * 68)
    print(f" Database : {db_path}")
    primary = primary_lan_url(port)
    others = [u for u in lan_urls(port) if u != primary]
    if primary:
        print(f" Teammates connect to:  {primary}")
        if others:
            # Named but demoted: these are usually virtualisation adapters,
            # and handing one to a teammate produces a hang, not an error.
            print(f" (other adapters, probably not the WiFi: {', '.join(others)})")
    else:
        print(" [!] No LAN address found. Is this machine on the WiFi?")
    print(f" On this machine: http://127.0.0.1:{port}")
    print()
    print(" If teammates cannot connect, allow port "
          f"{port} through Windows Firewall (see scripts/serve-lan.ps1).")
    print("=" * 68)

    import uvicorn

    uvicorn.run("apps.api.main:app", host=host, port=port, reload=False, log_level="info")


if __name__ == "__main__":
    main()
