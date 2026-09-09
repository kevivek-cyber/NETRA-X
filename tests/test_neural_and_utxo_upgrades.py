"""
Unit and API Integration Tests for Phase 5 Advanced Intelligence & AI Upgrades.
Verifies short-text neural stylometry abstention thresholds, UTXO mixer hop tracing,
cluster risk profile calculation, and Phase 5 REST endpoints.
"""

import pytest
from fastapi.testclient import TestClient

from packages.attribution.neural_stylometry import NeuralStylometryEngine
from packages.attribution.financial import UTXOCoSpendingClusterer
from apps.api.main import app


def test_neural_stylometry_insufficient_tokens_abstain():
    short_text_a = "Too short text"
    text_b = "This text has enough tokens to pass the token length requirement for author verification."
    
    res = NeuralStylometryEngine.verify_authorship(short_text_a, text_b)
    assert res["verdict"] == "ABSTAIN"
    assert "INSUFFICIENT_TOKEN_COUNT" in res["reason"]
    assert res["similarity_score"] == 0.0


def test_neural_stylometry_low_similarity_abstain():
    text_a = "Quantum computing algorithms utilize complex linear algebra transformations to optimize state vector calculation across qubits."
    text_b = "Ransomware operators encrypt database files using symmetric AES keys and demand cryptocurrency ransom payments."

    res = NeuralStylometryEngine.verify_authorship(text_a, text_b)
    assert res["verdict"] == "ABSTAIN"
    assert "LOW_SIMILARITY_CONFIDENCE" in res["reason"]


def test_neural_stylometry_match():
    text_a = "ShadowByte ransomware operator deploys custom PowerShell scripts to disable Windows Defender defenses before encrypting network drives."
    text_b = "ShadowByte threat actor executes PowerShell scripts disabling Windows Defender defenses prior to encrypting shared network drives."

    res = NeuralStylometryEngine.verify_authorship(text_a, text_b, threshold=0.55)
    assert res["verdict"] == "MATCH"
    assert res["similarity_score"] > 0.55
    assert res["llr_score"] > 0.0


def test_utxo_mixer_hop_tracing():
    txs = [
        {"txid": "tx1", "inputs": ["1BtcInputAddr"], "outputs": ["1WasabiMixerAddr", "1BtcIntermediateAddr"]},
        {"txid": "tx2", "inputs": ["1BtcIntermediateAddr"], "outputs": ["1ChipmixerHop2Addr"]}
    ]

    trace_res = UTXOCoSpendingClusterer.trace_mixer_hops(txs, start_address="1BtcInputAddr", max_hops=3)
    assert trace_res["start_address"] == "1BtcInputAddr"
    assert trace_res["total_addresses_reached"] >= 2
    assert trace_res["mixer_touchpoints_found"] >= 1


def test_utxo_cluster_risk_calculation():
    txs = [
        {"txid": "tx1", "inputs": ["cluster_btc_1"], "outputs": ["1WasabiMixerAddr"], "amount_btc": 2.5},
        {"txid": "tx2", "inputs": ["cluster_btc_2"], "outputs": ["1ChipmixerHop2Addr"], "amount_btc": 1.5}
    ]

    risk_res = UTXOCoSpendingClusterer.calculate_cluster_risk_score("cluster_btc", txs)
    assert risk_res["total_addresses"] >= 2
    assert risk_res["estimated_volume_btc"] == 4.0
    assert risk_res["risk_score"] > 0.3


def test_api_neural_stylometry_endpoint():
    client = TestClient(app)
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "text_a": "Threat actor DarkForums_Admin deploys custom PGP signature keys to verify darknet forum transactions.",
        "text_b": "DarkForums_Admin threat actor uses custom PGP signature keys to authenticate darknet market transactions.",
        "threshold": 0.50
    }

    resp = client.post("/api/v1/attribution/neural-stylometry", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["verdict"] in ["MATCH", "NO_MATCH", "ABSTAIN"]
    assert "confidence" in data


def test_api_financial_cluster_trace_endpoint():
    client = TestClient(app)
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "start_address": "1BtcStartAddr",
        "transactions": [
            {"txid": "tx10", "inputs": ["1BtcStartAddr"], "outputs": ["1WasabiMixerAddr", "1BtcOut2Addr"], "amount_btc": 5.0}
        ],
        "max_hops": 3,
        "cluster_id": "cluster_btc_alpha"
    }

    resp = client.post("/api/v1/financial/clusters/trace", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "trace" in data
    assert "risk_profile" in data
    assert data["risk_profile"]["risk_level"] in ["LOW", "MEDIUM", "HIGH"]
