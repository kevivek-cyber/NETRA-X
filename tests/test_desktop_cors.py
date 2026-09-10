"""
Desktop shell CORS.

The packaged Tauri app serves the UI from a webview origin and calls the
local API cross-origin, so CORS -- not just a reachable port -- decides
whether the desktop build can log in at all.

The origin differs by platform, and that is the bug these tests pin down:
macOS/Linux use the custom scheme `tauri://localhost`, but Windows/WebView2
serves the app from `https://tauri.localhost`. The desktop launcher's
allow-list originally named only the former, so every Windows install failed
its login preflight with 400 "Disallowed CORS origin" -- surfaced in the UI
as the much more misleading "Cannot reach the NETRA-X API".
"""
import pytest
from fastapi.testclient import TestClient

from apps.api.main import app

WINDOWS_TAURI_ORIGIN = "https://tauri.localhost"
UNIX_TAURI_ORIGIN = "tauri://localhost"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _preflight(client, origin):
    return client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )


@pytest.mark.parametrize(
    "origin",
    [WINDOWS_TAURI_ORIGIN, UNIX_TAURI_ORIGIN, "http://tauri.localhost"],
)
def test_login_preflight_allowed_from_tauri_webview(client, origin):
    """Every platform's Tauri webview origin must clear the login preflight."""
    response = _preflight(client, origin)
    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == origin


def test_unrelated_origin_still_rejected(client):
    """The fix must not turn the allow-list into a wildcard."""
    response = _preflight(client, "https://evil.example.com")
    assert response.status_code == 400
