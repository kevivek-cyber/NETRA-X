"""
Backend Unit & Integration Test Suite for NETRA-X Platform
Verifies LLR formulas, family caps, dependence discounting, contradiction penalties,
isotonic calibration, audit hash-chain integrity, and REST API endpoints.
"""

import pytest

# These two endpoints are backed by the optional [neural] extra. Skipping is
# right rather than asserting a fallback: the neural path legitimately abstains
# without torch, and asserting the abstain-shape here would test the fallback
# instead of the feature.
try:
    import torch  # noqa: F401
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False

_needs_torch = pytest.mark.skipif(
    not _TORCH_AVAILABLE, reason="requires the [neural] extra: pip install -e .[neural]"
)
from fastapi.testclient import TestClient
from packages.evidence.uuid7 import generate_uuidv7
from packages.evidence.auth import hash_password, verify_password, create_access_token, decode_access_token
from packages.evidence.attribution import (
    RawEvidenceInput, compute_attribution, calibrate_probability,
    determine_confidence_tier, EvidenceFamily
)
from packages.evidence.audit import verify_audit_chain
from apps.api.database.session import SyncSessionLocal, init_db_sync
from apps.api.database.models import User, Hypothesis, Evidence, AuditLog
from apps.api.main import app


@pytest.fixture(scope="module")
def test_client():
    init_db_sync()
    with TestClient(app) as client:
        yield client


def test_uuid7_generation():
    id1 = generate_uuidv7()
    id2 = generate_uuidv7()
    assert id1 != id2
    assert len(str(id1)) == 36


def test_password_hashing():
    pwd = "SecurePassword123!"
    hashed = hash_password(pwd)
    assert verify_password(pwd, hashed) is True
    assert verify_password("WrongPassword", hashed) is False


def test_jwt_token_issuance():
    token = create_access_token({"sub": "user_123", "role": "ANALYST"})
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == "user_123"
    assert payload["role"] == "ANALYST"


def test_llr_attribution_engine():
    items = [
        RawEvidenceInput(
            evidence_id="ev_01",
            family=EvidenceFamily.EXACT_IDENTITY.value,
            value="PGP Key Match",
            m_prob=0.99,
            u_prob=0.0001,
            dependence_group="DEP_1",
            source_uri="http://onion1.onion",
            extraction_method="pgp_parser",
            timestamp="2026-08-28T00:00:00Z",
            sha256="abc123hash"
        ),
        RawEvidenceInput(
            evidence_id="ev_02",
            family=EvidenceFamily.FINANCIAL.value,
            value="Wallet Match",
            m_prob=0.90,
            u_prob=0.001,
            dependence_group="DEP_2",
            source_uri="http://onion2.onion",
            extraction_method="wallet_cluster",
            timestamp="2026-08-28T00:00:00Z",
            sha256="abc123hash"
        )
    ]

    res = compute_attribution(items)
    assert res.raw_log_lr > 0
    assert res.calibrated_prob > 0.5
    assert res.confidence_tier in ["High Confidence", "Medium Confidence"]
    assert EvidenceFamily.EXACT_IDENTITY.value in res.family_scores


def test_contradiction_penalty_subtraction():
    items = [
        RawEvidenceInput(
            evidence_id="ev_01",
            family=EvidenceFamily.EXACT_IDENTITY.value,
            value="PGP Key Match",
            m_prob=0.99,
            u_prob=0.0001,
            dependence_group="DEP_1",
            source_uri="http://onion1.onion",
            extraction_method="pgp_parser",
            timestamp="2026-08-28T00:00:00Z",
            sha256="abc123hash"
        ),
        RawEvidenceInput(
            evidence_id="ev_contradiction",
            family=EvidenceFamily.TEMPORAL.value,
            value="Timezone conflict",
            m_prob=0.01,
            u_prob=0.95,
            dependence_group="DEP_CONFLICT",
            source_uri="http://onion3.onion",
            extraction_method="temporal_overlap",
            timestamp="2026-08-28T00:00:00Z",
            sha256="abc123hash",
            is_contradiction=True,
            contradiction_type="Temporal Impossibility"
        )
    ]

    res = compute_attribution(items)
    # Contradiction penalty (15.0) should lower the score significantly
    assert res.total_contradiction_penalty == 15.0
    assert len(res.contradiction_items) == 1


def test_hash_chained_audit_integrity():
    session = SyncSessionLocal()
    try:
        valid, count, err = verify_audit_chain(session)
        assert valid is True
        assert count > 0
        assert err is None
    finally:
        session.close()


def test_api_health_endpoint(test_client):
    response = test_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


def test_api_auth_login(test_client):
    response = test_client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "analyst@netra-x.local"


def test_api_get_actors(test_client):
    # Login first
    login_resp = test_client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]

    response = test_client.get(
        "/api/v1/actors",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    actors = response.json()
    assert len(actors) >= 1
    assert actors[0]["primary_alias"] == "ShadowByte"


def test_api_get_hypotheses_and_review(test_client):
    login_resp = test_client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    hyp_resp = test_client.get("/api/v1/hypotheses", headers=headers)
    assert hyp_resp.status_code == 200
    hypotheses = hyp_resp.json()
    assert len(hypotheses) >= 1
    target_id = hypotheses[0]["id"]

    # Submit Analyst Decision ACCEPT
    review_resp = test_client.post(
        f"/api/v1/hypotheses/{target_id}/review",
        headers=headers,
        json={"decision": "ACCEPT", "notes": "Multi-family evidence corroborated."}
    )
    assert review_resp.status_code == 200
    assert review_resp.json()["status"] in ["ACCEPT", "ACCEPTED"]


def test_api_audit_logs(test_client):
    login_resp = test_client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    audit_resp = test_client.get("/api/v1/audit", headers=headers)
    assert audit_resp.status_code == 200
    data = audit_resp.json()
    assert data["chain_valid"] is True
    assert len(data["logs"]) >= 1


def test_api_pdf_export(test_client):
    login_resp = test_client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    hyp_resp = test_client.get("/api/v1/hypotheses", headers=headers)
    target_id = hyp_resp.json()[0]["id"]

    pdf_resp = test_client.post(
        f"/api/v1/exports/report?hypothesis_id={target_id}",
        headers=headers
    )
    assert pdf_resp.status_code == 200
    assert pdf_resp.headers["content-type"] == "application/pdf"
    assert len(pdf_resp.content) > 1000


@_needs_torch
def test_api_neural_stylometry_endpoint(test_client):
    login_resp = test_client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = test_client.post(
        "/api/v1/stylometry/neural?text_a=Checking+tor+hidden+service.&text_b=Checking+tor+hidden+service.",
        headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["family"] == "STYLOMETRY"
    assert data["abstain"] is False


@_needs_torch
def test_api_graph_predict_link_endpoint(test_client):
    login_resp = test_client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = test_client.post(
        "/api/v1/graph/predict-link?node_a=actor_nstar7&node_b=alias_shadowbyte",
        headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["family"] == "INFRASTRUCTURE"
    assert "cosine_similarity" in data["metadata"]


def test_api_financial_utxo_endpoint(test_client):
    login_resp = test_client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    addr1 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
    addr2 = "132F25uv17spT6UXvuPvyVSp2wN7G4NKTq"
    resp = test_client.post(
        f"/api/v1/financial/utxo-clusters?address_a={addr1}&address_b={addr2}",
        headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "cluster_map" in data
    assert data["evidence_item"]["family"] == "FINANCIAL"


def test_api_attribution_waterfall_endpoint(test_client):
    login_resp = test_client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = test_client.post(
        "/api/v1/attribution/waterfall?target_actor=nstar_7&candidate_actor=ShadowByte",
        headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["decision"] == "HIGH_CONFIDENCE_LINK"
    assert "waterfall_breakdown" in data
    assert "ascii_diagram" in data
    assert "markdown_report" in data


def _search(test_client, q):
    login_resp = test_client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    resp = test_client.get(
        "/api/v1/search", params={"q": q},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    return resp.json()


def test_api_search_finds_a_shared_handle_across_aliases_and_accounts(test_client):
    # "ShadowByte" is a primary alias, a raw Alias row, and an Account handle
    # in the seed data -- previously only the Actor row (matched on primary
    # alias) was searchable, so an analyst pivoting off a handle seen in a
    # post or account listing got zero results.
    data = _search(test_client, "ShadowByte")
    entity_types = {r["entity_type"] for r in data["results"]}
    assert "ACTOR_ALIAS" in entity_types
    assert "ACCOUNT" in entity_types


def test_api_search_finds_a_secondary_alias_not_on_the_actor_record(test_client):
    # "CipherVoid" only exists as a secondary Alias row, never as an Actor's
    # primary_alias -- this is exactly the identifier the old actors-only
    # search could never surface.
    data = _search(test_client, "CipherVoid")
    assert any(r["entity_type"] == "ACTOR_ALIAS" for r in data["results"])


def test_api_search_finds_wallets_by_cluster_id(test_client):
    # Wallets sharing a cluster_id belong to the same actor and were only
    # matchable by exact address before; searching the cluster id itself
    # (the co-spend link an analyst actually has in hand) returned nothing.
    data = _search(test_client, "CLUSTER_SB_01")
    wallets = [r for r in data["results"] if r["entity_type"] == "CRYPTO_WALLET"]
    assert len(wallets) >= 2

