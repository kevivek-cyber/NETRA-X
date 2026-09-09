"""
Unit and API Integration Tests for Real-time Passive Collection Pipeline & OnionProbes.
Verifies mmh3 favicon hashing, status page detection, TLS cert fingerprinting,
ISO 28500 WARC creation, MinIO artifact storage, and Redis event bus dispatches.
"""

import base64
import os
import pytest
from fastapi.testclient import TestClient

from workers.collection.onion_probe import OnionProbeEngine
from workers.collection.warc_writer import WARCWriter, ImmutableArtifact, MinIOArtifactStorage
from workers.collection.event_bus import RedisEventBus, event_bus
from apps.api.main import app


def test_onion_probe_favicon_mmh3():
    favicon_bytes = b"\x00\x00\x01\x00\x01\x00\x10\x10\x00\x00\x01\x00\x24\x00"
    res = OnionProbeEngine.inspect_favicon(favicon_bytes)

    assert isinstance(res["mmh3_hash"], int)
    assert len(res["sha256"]) == 64
    assert res["shodan_query"].startswith("http.favicon.hash:")


def test_onion_probe_server_status_and_tls():
    html_status = "<html><body><h1>Apache Server Status for localhost</h1></body></html>"
    status_res = OnionProbeEngine.inspect_server_status(html_status)
    assert status_res["server_status_exposed"] is True
    assert status_res["leak_type"] == "APACHE_SERVER_STATUS"

    sample_cert_pem = "-----BEGIN CERTIFICATE-----\nMIIB...CN=onion.test\n-----END CERTIFICATE-----"
    tls_res = OnionProbeEngine.inspect_tls_cert(sample_cert_pem)
    assert tls_res["has_tls"] is True
    assert len(tls_res["sha256_fingerprint"]) == 64
    assert tls_res["shodan_query"].startswith("ssl.cert.sha256:")


def test_onion_probe_full_scan():
    report = OnionProbeEngine.probe_onion_target(
        target_url="http://testservice.onion",
        html_content="<h1>Apache Server Status</h1>",
        favicon_bytes=b"sample_favicon_icon_bytes",
        headers_dict={"Server": "Apache/2.4.41", "X-Powered-By": "PHP/7.4.3"},
        tls_cert_pem="-----BEGIN CERTIFICATE-----\nCN=test.onion\n-----END CERTIFICATE-----"
    )

    assert report["target_url"] == "http://testservice.onion"
    assert report["total_leaks_found"] >= 2
    assert "SERVER_STATUS_PAGE_EXPOSED" in report["leaks"]


def test_warc_writer_iso_format(tmp_path):
    raw_content = b"<html><body>Darknet Forum Dump</body></html>"
    artifact = ImmutableArtifact(raw_bytes=raw_content, source_uri="http://darkforum.onion/thread/1", content_type="text/html")
    warc_bytes = WARCWriter.create_warc_record(artifact)

    warc_str = warc_bytes.decode("utf-8", errors="ignore")
    assert "WARC/1.0" in warc_str
    assert "WARC-Type: response" in warc_str
    assert f"WARC-Target-URI: {artifact.source_uri}" in warc_str
    assert f"WARC-Payload-Digest: sha256:{artifact.sha256}" in warc_str

    # Test MinIO/FS storage
    storage = MinIOArtifactStorage(storage_dir=str(tmp_path))
    meta = storage.store_artifact(artifact, warc_bytes)
    assert os.path.exists(meta["filepath"])
    assert meta["payload_sha256"] == artifact.sha256


def test_redis_event_bus_publishing_and_consumer():
    bus = RedisEventBus()
    msg_id = bus.publish_event("stream:test_page", {"uri": "http://onion.test", "status": "collected"})
    assert msg_id is not None

    events = bus.consume_stream("stream:test_page", count=5)
    assert len(events) >= 1
    assert events[0]["payload"]["uri"] == "http://onion.test"


def test_api_probe_scan_endpoint():
    client = TestClient(app)
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    fav_b64 = base64.b64encode(b"sample_ico_bytes").decode("utf-8")
    payload = {
        "target_url": "http://leaktest.onion",
        "html_content": "<h1>Nginx Status</h1>",
        "favicon_b64": fav_b64,
        "headers": {"Server": "nginx/1.18.0"},
        "tls_cert_pem": "-----BEGIN CERTIFICATE-----\nCN=leak.onion\n-----END CERTIFICATE-----"
    }

    resp = client.post("/api/v1/probes/scan", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["target_url"] == "http://leaktest.onion"
    assert data["total_leaks_found"] >= 2


def test_api_warc_collection_endpoint():
    client = TestClient(app)
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "raw_content": "<html><body>Raw forum post observation payload</body></html>",
        "source_uri": "http://darknetmarket.onion/listing/99",
        "content_type": "text/html"
    }

    resp = client.post("/api/v1/collection/warc", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["warc_record_id"].startswith("<urn:uuid:")
    assert len(data["artifact_sha256"]) == 64
    assert os.path.exists(data["file_path"])
