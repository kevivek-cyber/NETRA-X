"""
Unit and API Integration Tests for Prometheus Metrics & OpenSearch Hybrid Search.
"""

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.metrics import metrics_collector
from packages.search.opensearch_client import opensearch_service


def test_metrics_collector_recording():
    metrics_collector.record_request("GET", "/test/path", 200, 0.05)
    metrics_collector.record_llr_evaluation()
    metrics_collector.record_audit_event()

    text_output = metrics_collector.generate_prometheus_text()
    assert "netrax_http_requests_total" in text_output
    assert "netrax_llr_evaluations_total" in text_output
    assert "netrax_audit_events_total" in text_output


def test_metrics_endpoint_api():
    client = TestClient(app)
    response = client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "netrax_http_requests_total" in response.text


def test_hybrid_search_api():
    client = TestClient(app)
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Search for ShadowByte actor alias
    response = client.get("/api/v1/search?q=ShadowByte", headers=headers)
    assert response.status_code == 200
    data = response.json()
    print("SEARCH RESPONSE DATA:", data)
    assert data["query"] == "ShadowByte"
    assert data["total_matches"] >= 1
    assert any(item["entity_type"] in ["ACTOR_ALIAS", "ACTOR"] for item in data["results"])
