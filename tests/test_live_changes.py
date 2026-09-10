"""
Live change feed.

Several analysts share one server, so a view opened by one person goes stale
the moment another edits. The UI polls this endpoint for a cursor and refetches
only when the cursor moves.

The feed is the audit log rather than a separate publish/subscribe channel.
Every mutating endpoint already appends an audit entry -- that is mandatory for
provenance, not optional -- and `seq` is monotonic and unique. A hand-placed
publish call in each endpoint could be forgotten, and the change would then
never reach anyone; an audit entry cannot be, without breaking the ledger.
"""
import pytest
from fastapi.testclient import TestClient

from apps.api.database.session import init_db_sync
from apps.api.main import app


@pytest.fixture(scope="module")
def client():
    init_db_sync()
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def auth(client):
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_requires_authentication(client):
    """The feed names who did what; it is not public."""
    assert client.get("/api/v1/changes").status_code in (401, 403)


def test_returns_a_cursor(client, auth):
    body = client.get("/api/v1/changes", headers=auth).json()
    assert isinstance(body["cursor"], int)
    assert isinstance(body["changes"], list)


def test_no_changes_when_nothing_happened(client, auth):
    """Polling repeatedly with the latest cursor must stay quiet.

    If this returned rows, every client would refetch everything every poll.
    """
    cursor = client.get("/api/v1/changes", headers=auth).json()["cursor"]
    body = client.get(f"/api/v1/changes?since={cursor}", headers=auth).json()
    assert body["changes"] == []
    assert body["cursor"] == cursor


def test_a_mutation_appears_in_the_feed(client, auth):
    """What one analyst does becomes visible to the others."""
    before = client.get("/api/v1/changes", headers=auth).json()["cursor"]

    created = client.post(
        "/api/v1/investigations",
        headers=auth,
        json={"title": "Live feed case", "description": "created to move the cursor"},
    )
    assert created.status_code in (200, 201), created.text

    body = client.get(f"/api/v1/changes?since={before}", headers=auth).json()
    assert body["cursor"] > before
    assert len(body["changes"]) >= 1

    entry = body["changes"][-1]
    assert entry["seq"] > before
    # Enough for the UI to decide what to refetch and to say who did it.
    for field in ("seq", "action", "resource_type", "resource_id", "actor", "at"):
        assert field in entry


def test_feed_is_bounded(client, auth):
    """A client returning after a long absence must not pull the whole ledger."""
    body = client.get("/api/v1/changes?since=0&limit=5", headers=auth).json()
    assert len(body["changes"]) <= 5
    # The cursor still reports the true head, so the client resynchronises in
    # one step instead of paging forward through history it does not need.
    assert body["cursor"] >= max((c["seq"] for c in body["changes"]), default=0)
