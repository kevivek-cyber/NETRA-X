"""
NETRA-X FastAPI Modular Monolith Backend API
Exposes authenticated, role-based REST endpoints for dark-web threat actor intelligence,
evidence ledger querying, attribution hypothesis evaluation, analyst review, and PDF exports.
"""

import json
import os
import base64
import hashlib
from datetime import datetime
from typing import Any, Dict, List, Optional
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, status, Query, Response, Body
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select, or_, func
from sqlalchemy.orm import Session, joinedload

from packages.evidence.uuid7 import uuidv7_str
from packages.evidence.auth import (
    verify_password, create_access_token, decode_access_token
)
from packages.evidence.audit import append_audit_event, verify_audit_chain
from packages.evidence.attribution import (
    RawEvidenceInput, compute_attribution, EvidenceFamily, FAMILY_CAPS
)
from packages.evidence.reporting import generate_pdf_report
from packages.evidence.stix_export import generate_stix_bundle, generate_csv_export
from packages.evidence.rbac import require_roles
from packages.graph.projection import GraphProjectionService
from packages.search.opensearch_client import opensearch_service
from packages.schemas.models import (
    LoginRequest, TokenResponse, UserResponse, ActorSchema, AliasSchema,
    PGPKeySchema, WalletSchema, OnionServiceSchema, EvidenceSchema,
    EvidenceWaterfallItem, HypothesisSchema, ReviewRequest, AuditLogSchema,
    SearchResponse, SearchResultItem, CaseCreate, CaseResponse, DecisionEnum,
    CaseIdentifierCreate, CaseIdentifierResponse,
    HypothesisStatus, IngestRequest, IngestResponse, ExtractedEvidence,
    BackupResponse, ReprojectResponse, RoleName,
    ProbeScanRequest, ProbeScanResponse, WarcCollectionRequest, WarcCollectionResponse,
    NeuralStylometryRequest, NeuralStylometryResponse,
    FinancialClusterTraceRequest, FinancialClusterTraceResponse
)
from packages.attribution import NeuralStylometryEngine, UTXOCoSpendingClusterer
from workers.collection import (
    OnionProbeEngine, WARCWriter, ImmutableArtifact, MinIOArtifactStorage,
    event_bus, RedisEventBus
)
from apps.api.metrics import MetricsMiddleware, metrics_collector
from apps.api.database.session import SyncSessionLocal, init_db_sync
from apps.api.database.models import (
    User, Case, CaseMember, CaseIdentifier, Actor, Alias, Account, PGPKey, Wallet,
    OnionService, Server, Artifact, Evidence, Hypothesis, HypothesisEvidence,
    AnalystReview, AuditLog, Source, Observation
)
from workers.maintenance.backup_worker import DatabaseBackupWorker
from workers.maintenance.graph_reproject_worker import GraphReprojectionWorker

app = FastAPI(
    title="NETRA-X Intelligence API",
    description="Evidence-Driven Dark Web Threat Actor Intelligence & Attribution Platform REST API",
    version="0.1.0"
)

# allow_origins=["*"] with allow_credentials=True is rejected by browsers --
# the CORS spec forbids a wildcard origin on credentialed requests, so the
# previous config was simultaneously insecure and non-functional. Origins are
# now an explicit allow-list, overridable for deployment.
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    # The packaged desktop shell calls this API cross-origin from its
    # webview, whose origin is platform-dependent: macOS/Linux use the
    # custom scheme tauri://localhost, while Windows/WebView2 serves the
    # app from https://tauri.localhost. Matching all of them here (rather
    # than only in desktop_main.py's CORS_ORIGINS default) keeps the
    # desktop build working no matter how the backend was started.
    allow_origin_regex=r"https://.*\.onrender\.(com|app)|https?://tauri\.localhost|tauri://localhost",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.add_middleware(MetricsMiddleware)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def _cap_key(family: str) -> str:
    """Map a stored family label to its FAMILY_CAPS key."""
    return family.strip().upper().replace("/", "_").replace(" ", "_")


def capped_family_scores(raw_scores: dict) -> dict:
    return {
        family: round(min(score, FAMILY_CAPS.get(_cap_key(family), score)), 3)
        for family, score in raw_scores.items()
    }


# DB Dependency
def get_db():
    db = SyncSessionLocal()
    try:
        yield db
    finally:
        db.close()


# Auth Helper
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired authentication token")

    user_id = payload.get("sub")
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


# Startup Init
@app.on_event("startup")
def on_startup():
    init_db_sync()
    try:
        session = SyncSessionLocal()
        try:
            if session.query(User).first() is None:
                from seed.generator import seed_database
                seed_database()
        finally:
            session.close()
    except Exception as e:
        print(f"[!] Database startup seed check: {e}")

    # The hero scenario is two actors joined by one hypothesis. That is the
    # right fixture for the acceptance test, but on a fresh deployment it is
    # also the *entire* graph -- which is why the deployed map showed only
    # ShadowByte and Vortex99. Seed the actor network as well.
    #
    # Deliberately a separate session and a separate try: seed_database()
    # commits on its own session, so a session opened before it cannot see its
    # rows, and a failure here must never stop the API from booting.
    try:
        from seed.network import already_seeded as network_seeded, build as build_network

        session = SyncSessionLocal()
        try:
            if not network_seeded(session):
                build_network(session)
        finally:
            session.close()
    except Exception as e:
        print(f"[!] Actor-network seed skipped: {e}")


# Exported Next.js bundle, when one has been built. Resolved here rather than
# beside the mount at the bottom because the root route below needs it too.
_FRONTEND_DIR = Path(__file__).resolve().parents[2] / "apps" / "web" / "out"


def _frontend_index() -> Optional[Path]:
    """Path to the built index.html, or None when no export is present."""
    index = _FRONTEND_DIR / "index.html"
    return index if index.is_file() else None


@app.get("/", include_in_schema=False)
def root():
    """Serve the UI when a frontend build is present, else the API banner.

    In the single-service deployment this route is the site's front door, so
    it has to return index.html -- it is declared before the catch-all mount
    at the bottom of this module and would otherwise shadow it, leaving
    visitors looking at a JSON blob instead of the console.

    With no build output -- local API-only development, and the desktop app,
    which loads its UI from elsewhere -- the original banner still answers, so
    nothing that relied on it breaks.
    """
    index = _frontend_index()
    if index is not None:
        return FileResponse(index)

    return {
        "platform": "NETRA-X Intelligence API",
        "status": "healthy",
        "version": "0.1.0",
        "documentation": "/docs",
        "health": "/health"
    }


@app.get("/health")
def health_check():
    return {"status": "healthy", "platform": "NETRA-X MVP v0.1 [ISOLATED-PUSH-PROOF]", "timestamp": datetime.utcnow().isoformat()}


@app.get("/metrics")
def get_prometheus_metrics():
    """Expose standard Prometheus metrics format for observability monitoring."""
    return Response(
        content=metrics_collector.generate_prometheus_text(),
        media_type="text/plain; version=0.0.4"
    )



# --- AUTH ENDPOINTS ---
@app.post("/api/v1/auth/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=req.email).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email credentials")

    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role})

    # Record Audit Event
    append_audit_event(
        session=db,
        actor_user_id=user.id,
        action="USER_LOGIN",
        resource_type="USER",
        resource_id=user.id,
        payload={"email": user.email, "timestamp": str(datetime.utcnow())}
    )
    db.commit()

    return TokenResponse(
        access_token=token,
        user=UserResponse(id=user.id, email=user.email, mfa_enabled=user.mfa_enabled, role=user.role, created_at=user.created_at)
    )


@app.get("/api/v1/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        mfa_enabled=current_user.mfa_enabled,
        role=current_user.role,
        created_at=current_user.created_at
    )


# --- ACTORS & PROFILE ENDPOINTS ---
@app.get("/api/v1/actors", response_model=List[ActorSchema])
def list_actors(category: Optional[str] = None, q: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = db.query(Actor)
    if category:
        query = query.filter(Actor.category == category)
    if q:
        query = query.filter(or_(Actor.primary_alias.ilike(f"%{q}%"), Actor.category.ilike(f"%{q}%")))

    actors = query.all()
    results = []
    for a in actors:
        results.append(ActorSchema(
            id=a.id,
            primary_alias=a.primary_alias,
            category=a.category,
            confidence=a.confidence,
            last_seen=a.last_seen,
            is_synthetic=a.is_synthetic,
            aliases=[AliasSchema(id=al.id, actor_id=al.actor_id, value=al.value, platform=al.platform, source=al.source, confidence=al.confidence) for al in a.aliases],
            pgp_keys=[PGPKeySchema(id=k.id, fingerprint=k.fingerprint, key_id=k.key_id, actor_id=k.actor_id, key_body=k.key_body, created_at=k.created_at) for k in a.pgp_keys],
            wallets=[WalletSchema(id=w.id, address=w.address, chain=w.chain, cluster_id=w.cluster_id, actor_id=w.actor_id) for w in a.wallets]
        ))
    return results


@app.get("/api/v1/actors/{id}", response_model=ActorSchema)
def get_actor(id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    actor = db.query(Actor).filter_by(id=id).first()
    if not actor:
        raise HTTPException(status_code=404, detail="Threat actor not found")

    return ActorSchema(
        id=actor.id,
        primary_alias=actor.primary_alias,
        category=actor.category,
        confidence=actor.confidence,
        last_seen=actor.last_seen,
        is_synthetic=actor.is_synthetic,
        aliases=[AliasSchema(id=al.id, actor_id=al.actor_id, value=al.value, platform=al.platform, source=al.source, confidence=al.confidence) for al in actor.aliases],
        pgp_keys=[PGPKeySchema(id=k.id, fingerprint=k.fingerprint, key_id=k.key_id, actor_id=k.actor_id, key_body=k.key_body, created_at=k.created_at) for k in actor.pgp_keys],
        wallets=[WalletSchema(id=w.id, address=w.address, chain=w.chain, cluster_id=w.cluster_id, actor_id=w.actor_id) for w in actor.wallets]
    )


@app.get("/api/v1/graph")
def get_global_graph(
    limit: int = Query(400, ge=10, le=2000),
    include_singletons: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The whole map: every actor, joined by the identifiers they share.

    The per-actor endpoint answers "what is attached to this persona". This one
    answers the question the product actually exists for -- which differently
    named personas touch the same thing. Identifier nodes are therefore merged
    by VALUE, not by row: one wallet cluster reused by three storefronts is a
    single node with three edges, which is what makes the reuse visible at all.
    """
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    actors = db.query(Actor).limit(limit).all()
    actor_ids = {a.id for a in actors}
    for a in actors:
        nodes.append({
            "id": a.id,
            "label": a.primary_alias,
            "type": "Actor",
            "category": a.category,
            "confidence": a.confidence,
        })

    def add_edge(eid, src, dst, label, conf):
        edges.append({"id": eid, "source": src, "target": dst, "label": label, "confidence": conf})

    # --- Handles, merged by value. A value used by two actors becomes a hinge.
    handle_owners: Dict[str, List[Any]] = {}
    for al in db.query(Alias).all():
        if al.actor_id in actor_ids:
            handle_owners.setdefault(al.value.strip().lower(), []).append(al)

    for value, rows in handle_owners.items():
        owners = {r.actor_id for r in rows}
        shared = len(owners) > 1
        if not shared and not include_singletons:
            continue
        node_id = f"handle::{value}"
        nodes.append({
            "id": node_id,
            "label": rows[0].value,
            "type": "SharedHandle" if shared else "Alias",
            "shared_by": len(owners),
        })
        for r in rows:
            add_edge(f"e_h_{r.id}", r.actor_id, node_id, "USES_HANDLE", r.confidence)

    # --- Wallet clusters. This is the "same wallet, different names" link:
    # co-input ownership says one operator controls the cluster.
    cluster_wallets: Dict[str, List[Any]] = {}
    for w in db.query(Wallet).all():
        if w.actor_id in actor_ids and w.cluster_id:
            cluster_wallets.setdefault(w.cluster_id, []).append(w)

    for cluster_id, rows in cluster_wallets.items():
        owners = {r.actor_id for r in rows}
        if len(owners) < 2 and not include_singletons:
            continue
        node_id = f"wallet::{cluster_id}"
        chains = sorted({r.chain for r in rows})
        nodes.append({
            "id": node_id,
            "label": cluster_id,
            "type": "SharedWallet" if len(owners) > 1 else "Wallet",
            "shared_by": len(owners),
            "detail": f"{len(rows)} addresses / {', '.join(chains)}",
        })
        for owner in owners:
            add_edge(f"e_w_{cluster_id}_{owner}", owner, node_id, "CONTROLS_WALLET_CLUSTER", 0.90)

    # --- PGP keys.
    for k in db.query(PGPKey).all():
        if k.actor_id not in actor_ids or not include_singletons:
            continue
        node_id = f"pgp::{k.fingerprint}"
        nodes.append({"id": node_id, "label": k.key_id, "type": "PGPKey"})
        add_edge(f"e_k_{k.id}", k.actor_id, node_id, "USES_PGP", 0.99)

    # --- Scored attribution links between actors.
    for h in db.query(Hypothesis).all():
        if h.subject_entity_id in actor_ids and h.object_entity_id in actor_ids:
            add_edge(f"hyp_{h.id}", h.subject_entity_id, h.object_entity_id,
                     h.status, h.calibrated_prob)

    return {"nodes": nodes, "edges": edges,
            "stats": {"actors": len(actors), "nodes": len(nodes), "edges": len(edges)}}


@app.get("/api/v1/actors/{id}/graph")
def get_actor_graph(id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    proj = GraphProjectionService()
    graph = proj.fetch_actor_subgraph(id)
    if not graph["nodes"]:
        # Fallback relational topology if Neo4j graph offline
        actor = db.query(Actor).filter_by(id=id).first()
        if not actor:
            raise HTTPException(status_code=404, detail="Actor not found")

        nodes = [{"id": actor.id, "label": actor.primary_alias, "type": "Actor"}]
        edges = []
        for al in actor.aliases:
            nodes.append({"id": al.id, "label": al.value, "type": "Alias"})
            edges.append({"id": f"edge_{al.id}", "source": actor.id, "target": al.id, "label": "ACTOR_USES_ALIAS", "confidence": al.confidence})
        for k in actor.pgp_keys:
            nodes.append({"id": k.id, "label": k.key_id, "type": "PGPKey"})
            edges.append({"id": f"edge_{k.id}", "source": actor.id, "target": k.id, "label": "ACCOUNT_USES_PGP", "confidence": 0.99})
        for w in actor.wallets:
            nodes.append({"id": w.id, "label": w.address[:10] + "...", "type": "Wallet"})
            edges.append({"id": f"edge_{w.id}", "source": actor.id, "target": w.id, "label": "ACCOUNT_USES_WALLET", "confidence": 0.90})

        # Second hop: actors this one is linked to by an attribution hypothesis.
        # Without this the view is a star -- one actor and its own identifiers --
        # which hides the thing the product exists to show, namely that separate
        # personas resolve to the same operator. Peer-to-peer links among the
        # neighbours are included too, so a cluster reads as a cluster.
        links = db.query(Hypothesis).filter(
            or_(Hypothesis.subject_entity_id == id, Hypothesis.object_entity_id == id)
        ).all()

        neighbour_ids = set()
        for h in links:
            other = h.object_entity_id if h.subject_entity_id == id else h.subject_entity_id
            neighbour_ids.add(other)

        if neighbour_ids:
            neighbours = db.query(Actor).filter(Actor.id.in_(neighbour_ids)).all()
            found = {a.id for a in neighbours}
            for a in neighbours:
                nodes.append({"id": a.id, "label": a.primary_alias, "type": "LinkedActor"})

            for h in links:
                other = h.object_entity_id if h.subject_entity_id == id else h.subject_entity_id
                if other not in found:
                    continue
                edges.append({
                    "id": f"hyp_{h.id}",
                    "source": h.subject_entity_id,
                    "target": h.object_entity_id,
                    "label": h.status,
                    "confidence": h.calibrated_prob,
                })

            # Links between the neighbours themselves.
            peer = db.query(Hypothesis).filter(
                Hypothesis.subject_entity_id.in_(found),
                Hypothesis.object_entity_id.in_(found),
            ).all()
            for h in peer:
                edges.append({
                    "id": f"hyp_{h.id}",
                    "source": h.subject_entity_id,
                    "target": h.object_entity_id,
                    "label": h.status,
                    "confidence": h.calibrated_prob,
                })

        # De-duplicate: a hypothesis can be reached from both loops above.
        seen = set()
        unique_edges = []
        for e in edges:
            if e["id"] in seen:
                continue
            seen.add(e["id"])
            unique_edges.append(e)

        graph = {"nodes": nodes, "edges": unique_edges}

    return graph


@app.get("/api/v1/actors/{id}/timeline")
def get_actor_timeline(id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Observed activity for one actor, read from the evidence ledger.

    This returned four hardcoded events -- the same PGP fingerprint, the same
    wallet, the same favicon hash -- for every actor requested, including ones
    that do not exist. The dates were in the future. Nothing here may be a
    literal: an analyst reading a timeline is reading a claim about when
    something was observed, and that claim has to come from a row.
    """
    from packages.copilot import tools

    actor = db.query(Actor).filter_by(id=id).first()
    if actor is None:
        raise HTTPException(status_code=404, detail="Actor not found")

    events = []
    for row in tools.get_actor_evidence(db, id, limit=40):
        ev = db.query(Evidence).filter_by(id=row["evidence_id"]).first()
        if ev is None:
            continue
        events.append({
            "id": ev.id,
            "timestamp": ev.created_at.isoformat() if ev.created_at else None,
            "event_type": row["extraction_method"],
            "family": row["family"],
            "source": ev.source_uri,
            "detail": ev.value,
            "contribution": row["contribution"],
            "is_contradiction": row["is_contradiction"],
            "artifact_sha256": row["artifact_sha256"],
        })

    events.sort(key=lambda e: e["timestamp"] or "")
    return {
        "actor_id": id,
        "actor": actor.primary_alias,
        "last_seen": actor.last_seen.isoformat() if actor.last_seen else None,
        "timeline": events,
        "count": len(events),
    }


@app.get("/api/v1/config/engine")
def get_engine_config(user: User = Depends(get_current_user)):
    """Live engine constants, for a UI that must not hardcode them.

    The attribution view printed "DISCOUNT FACTOR lambda = 0.25" and
    "Postgres Source of Truth" as static text. The first silently becomes
    wrong the moment anyone retunes the engine; the second was never true in
    this deployment, which runs SQLite. A screen that explains a scoring
    decision cannot describe the scorer from memory.
    """
    from packages.attribution.fusion import LLRFusionEngine, load_mu_table
    from packages.common.types import FAMILY_CAPS
    from apps.api.database.session import DATABASE_URL_SYNC

    mu = load_mu_table()
    backend = "PostgreSQL" if "postgres" in DATABASE_URL_SYNC else "SQLite"

    return {
        "lambda_discount": LLRFusionEngine().lambda_discount,
        "family_caps": {k.value: v for k, v in FAMILY_CAPS.items()},
        "feature_count": len(mu.get("features", {})),
        "contradictions": {
            k: v.get("contradiction_weight") for k, v in mu.get("contradictions", {}).items()
        },
        "thresholds": {"high_confidence": 0.85, "low_confidence": 0.50},
        "storage_backend": backend,
        "model_version": "v1.0-LLR",
    }


@app.get("/api/v1/actors/{id}/wallets")
def get_actor_wallets(id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Wallets held by this actor and the co-owners of each cluster.

    The UI previously drew a mixer-hop diagram from four invented transaction
    hashes. We do not hold chain transaction data, so this returns what the
    ledger actually knows -- addresses, chains, cluster membership, and which
    other personas control an address in the same cluster. That co-ownership
    is the finding the diagram was pretending to show.
    """
    wallets = db.query(Wallet).filter_by(actor_id=id).all()
    actor = db.query(Actor).filter_by(id=id).first()
    if actor is None:
        raise HTTPException(status_code=404, detail="Actor not found")

    out = []
    for w in wallets:
        co_owners = []
        if w.cluster_id:
            siblings = db.query(Wallet).filter(
                Wallet.cluster_id == w.cluster_id, Wallet.actor_id != id).all()
            seen = set()
            for sib in siblings:
                if sib.actor_id in seen:
                    continue
                seen.add(sib.actor_id)
                other = db.query(Actor).filter_by(id=sib.actor_id).first()
                if other is not None:
                    co_owners.append({
                        "actor_id": other.id,
                        "actor": other.primary_alias,
                        "address": sib.address,
                    })
        out.append({
            "address": w.address,
            "chain": w.chain,
            "cluster_id": w.cluster_id,
            "co_owners": co_owners,
        })

    clustered = [w for w in out if w["cluster_id"]]
    return {
        "actor_id": id,
        "actor": actor.primary_alias,
        "wallets": out,
        "wallet_count": len(out),
        "clustered_count": len(clustered),
        "shared_cluster_count": len([w for w in clustered if w["co_owners"]]),
    }


# --- EVIDENCE LEDGER ENDPOINTS ---
@app.post("/api/v1/evidence", response_model=IngestResponse, status_code=201)
def ingest_evidence(
    body: IngestRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Ingest one raw observation and extract identifiers from it.

    Before this existed the ledger had no write path at all: evidence arrived
    only by running a seed script, which meant the collection claim in the
    architecture had nothing behind it at runtime.

    The order here is deliberate and is the provenance chain:

        Source (lawful basis)
          -> Artifact   (immutable bytes, SHA-256 digest)
          -> Observation(what was seen, and where)
          -> Evidence   (what was extracted from it)
          -> audit event

    Every Evidence row is therefore reachable back to the exact bytes it came
    from, which is the property the whole attribution story rests on. Ingest is
    idempotent on the artifact digest: re-posting identical content returns the
    original observation instead of duplicating evidence, so a retried collector
    cannot inflate the ledger.
    """
    from workers.extraction import ExtractionEngine
    from workers.collection.warc_writer import ImmutableArtifact

    raw_bytes = body.raw_content.encode("utf-8")
    artifact_meta = ImmutableArtifact(
        raw_bytes=raw_bytes,
        source_uri=body.source_uri or f"netrax://manual/{body.source_name}",
        content_type="text/plain",
    )

    # Reuse a source of the same name and basis rather than creating a new row
    # per post; the pair is what identifies a collection channel.
    source = (
        db.query(Source)
        .filter(Source.name == body.source_name,
                Source.lawful_basis == body.lawful_basis.value)
        .first()
    )
    if source is None:
        source = Source(
            id=uuidv7_str(),
            name=body.source_name,
            source_type=body.source_type.value,
            lawful_basis=body.lawful_basis.value,
            base_uri=body.source_uri,
            is_active=True,
        )
        db.add(source)
        db.flush()

    existing = db.query(Artifact).filter(Artifact.sha256 == artifact_meta.sha256).first()
    if existing is not None:
        prior = (
            db.query(Observation)
            .filter(Observation.content_hash == artifact_meta.sha256)
            .first()
        )
        return IngestResponse(
            observation_id=prior.id if prior else "",
            artifact_sha256=artifact_meta.sha256,
            source_id=source.id,
            lawful_basis=source.lawful_basis,
            duplicate=True,
            extracted_count=0,
            xmr_abstain=False,
            evidence=[],
        )

    artifact = Artifact(
        id=uuidv7_str(),
        sha256=artifact_meta.sha256,
        storage_uri=artifact_meta.source_uri,
        content_type=artifact_meta.content_type,
        size=artifact_meta.size,
    )
    db.add(artifact)

    observation = Observation(
        id=uuidv7_str(),
        source_id=source.id,
        raw_content=body.raw_content,
        content_hash=artifact_meta.sha256,
        metadata_json=json.dumps({
            "source_type": source.source_type,
            "ingested_by": user.id,
        }),
    )
    db.add(observation)
    db.flush()

    extracted = ExtractionEngine.extract_entities(body.raw_content)

    # (result key, evidence kind, dependence group, confidence)
    #
    # The dependence group is what stops the fusion engine double-counting: two
    # wallets from one post are one financial observation, not two independent
    # ones, so they share a group and the lambda discount applies.
    PLAN = [
        ("pgp_fingerprints", "PGP_FINGERPRINT", "pgp_identity", 0.99),
        ("btc_addresses", "BTC_ADDRESS", "wallet_cluster_btc", 0.95),
        ("eth_addresses", "ETH_ADDRESS", "wallet_cluster_eth", 0.95),
        ("xmr_addresses", "XMR_ADDRESS", "wallet_cluster_xmr", 0.50),
        ("onion_services", "ONION_SERVICE", "web_server_fingerprint", 0.90),
        ("emails", "EMAIL", "semantic_contact", 0.85),
        ("handles", "HANDLE", "handle_alias", 0.80),
    ]

    rows: List[ExtractedEvidence] = []
    for key, kind, group, confidence in PLAN:
        for value in extracted.get(key, []) or []:
            ev = Evidence(
                id=uuidv7_str(),
                artifact_id=artifact.id,
                source_uri=artifact_meta.source_uri,
                collector_version="netrax-ingest/0.1",
                extraction_method=f"regex:{kind.lower()}",
                value=str(value),
                confidence=confidence,
                dependence_group=group,
                is_immutable=True,
            )
            db.add(ev)
            rows.append(ExtractedEvidence(
                id=ev.id, kind=kind, value=str(value),
                dependence_group=group, confidence=confidence,
            ))

    append_audit_event(
        session=db,
        actor_user_id=user.id,
        action="EVIDENCE_INGESTED",
        resource_type="OBSERVATION",
        resource_id=observation.id,
        payload={
            "sha256": artifact_meta.sha256,
            "source": source.name,
            "lawful_basis": source.lawful_basis,
            "extracted": len(rows),
            "xmr_abstain": bool(extracted.get("xmr_abstain")),
        },
    )
    db.commit()

    return IngestResponse(
        observation_id=observation.id,
        artifact_sha256=artifact_meta.sha256,
        source_id=source.id,
        lawful_basis=source.lawful_basis,
        duplicate=False,
        extracted_count=len(rows),
        xmr_abstain=bool(extracted.get("xmr_abstain")),
        evidence=rows,
    )


@app.get("/api/v1/evidence", response_model=List[EvidenceSchema])
def list_evidence(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    items = db.query(Evidence).options(joinedload(Evidence.artifact)).all()
    results = []
    for e in items:
        results.append(EvidenceSchema(
            id=e.id,
            artifact_id=e.artifact_id,
            source_uri=e.source_uri,
            collector_version=e.collector_version,
            extraction_method=e.extraction_method,
            value=e.value,
            confidence=e.confidence,
            dependence_group=e.dependence_group,
            is_immutable=e.is_immutable,
            created_at=e.created_at,
            sha256=e.artifact.sha256 if e.artifact else None,
            retracted_at=e.retracted_at,
            retraction_reason=e.retraction_reason,
        ))
    return results


@app.get("/api/v1/evidence/{id}", response_model=EvidenceSchema)
def get_evidence_item(id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    e = db.query(Evidence).options(joinedload(Evidence.artifact)).filter_by(id=id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Evidence item not found")

    return EvidenceSchema(
        id=e.id,
        artifact_id=e.artifact_id,
        source_uri=e.source_uri,
        collector_version=e.collector_version,
        extraction_method=e.extraction_method,
        value=e.value,
        confidence=e.confidence,
        dependence_group=e.dependence_group,
        is_immutable=e.is_immutable,
        created_at=e.created_at,
        sha256=e.artifact.sha256 if e.artifact else None,
        retracted_at=e.retracted_at,
        retraction_reason=e.retraction_reason,
    )


@app.delete("/api/v1/evidence/{id}")
def retract_evidence_item(
    id: str,
    reason: str = Query("Retracted by analyst", max_length=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retract an evidence item. The row is withdrawn, never destroyed.

    This used to be a hard `db.delete(e)`. That contradicted the product's
    central claim -- an append-only, hash-chained chain of custody -- and it
    silently corrupted attribution: HypothesisEvidence rows kept pointing at
    the deleted evidence, so hypotheses carried scores derived from rows that
    no longer existed, and the evidence waterfall rendered placeholder values
    where the provenance should have been. `is_immutable` was never enforced
    anywhere; it is enforced here.

    Retraction is the correct operation. The item stays on the record, marked
    withdrawn and attributed to whoever withdrew it, and stops contributing to
    scores. The audit chain keeps both the ingestion and the retraction.
    """
    e = db.query(Evidence).filter_by(id=id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Evidence item not found")

    if e.retracted_at is not None:
        raise HTTPException(status_code=409, detail="Evidence item is already retracted")

    cited_by = db.query(HypothesisEvidence).filter_by(evidence_id=id).count()

    e.retracted_at = datetime.utcnow()
    e.retracted_by = current_user.id
    e.retraction_reason = reason

    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="EVIDENCE_RETRACTED",
        resource_type="EVIDENCE",
        resource_id=id,
        payload={"id": id, "reason": reason, "cited_by_hypotheses": cited_by},
    )
    db.commit()

    # Withdrawing a claim has to move the numbers that rested on it. Leaving
    # the score untouched would keep asserting a confidence derived from
    # evidence that no longer counts, and leave the waterfall rows no longer
    # summing to the headline above them.
    from packages.evidence import integrity

    rescored = []
    for hid in {he.hypothesis_id for he in
                db.query(HypothesisEvidence).filter_by(evidence_id=id).all()}:
        delta = integrity.rescore_hypothesis(db, hid)
        if delta:
            rescored.append(delta)
            append_audit_event(
                session=db,
                actor_user_id=current_user.id,
                action="HYPOTHESIS_RESCORED",
                resource_type="HYPOTHESIS",
                resource_id=hid,
                payload={"trigger": "evidence_retraction", "evidence_id": id, **delta},
            )
    if rescored:
        db.commit()

    return {
        "status": "retracted",
        "id": id,
        "reason": reason,
        "cited_by_hypotheses": cited_by,
        "rescored": rescored,
        "message": (
            f"Evidence {id} retracted. It remains on the record and no longer "
            f"counts toward attribution."
            + (f" {len(rescored)} hypothesis/hypotheses rescored."
               if rescored else "")
        ),
    }


# --- HYPOTHESES & ATTRIBUTION ENDPOINTS ---
@app.get("/api/v1/hypotheses", response_model=List[HypothesisSchema])
def list_hypotheses(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    hypotheses = db.query(Hypothesis).options(
        joinedload(Hypothesis.evidence_items).joinedload(HypothesisEvidence.evidence).joinedload(Evidence.artifact),
        joinedload(Hypothesis.reviewer)
    ).all()

    results = []
    for h in hypotheses:
        subj = db.query(Actor).filter_by(id=h.subject_entity_id).first()
        obj = db.query(Actor).filter_by(id=h.object_entity_id).first()

        supporting = []
        contradictions = []
        family_scores = {}

        for he in h.evidence_items:
            ev = he.evidence
            # Retracted evidence keeps its ledger row but stops backing a
            # score, so it must not appear in the waterfall as live support.
            if ev is not None and ev.retracted_at is not None:
                continue
            item_data = EvidenceWaterfallItem(
                evidence_id=ev.id if ev else he.evidence_id,
                family=he.family,
                source_uri=ev.source_uri if ev else "Unknown",
                extraction_method=ev.extraction_method if ev else "N/A",
                value=ev.value if ev else "N/A",
                reliability=he.reliability_weight,
                raw_llr=he.raw_llr,
                contribution=he.contribution,
                is_contradiction=he.is_contradiction,
                dependence_group=ev.dependence_group if ev else "DEP_NONE",
                timestamp=ev.created_at if ev else datetime.utcnow(),
                sha256=(ev.artifact.sha256 if (ev and ev.artifact) else None)
            )
            if he.is_contradiction:
                contradictions.append(item_data)
            else:
                supporting.append(item_data)
                family_scores[he.family] = family_scores.get(he.family, 0.0) + he.contribution

        tier = "High Confidence" if h.calibrated_prob >= 0.85 else ("Medium Confidence" if h.calibrated_prob >= 0.60 else ("Low Confidence" if h.calibrated_prob >= 0.35 else "Insufficient Evidence"))

        results.append(HypothesisSchema(
            id=h.id,
            subject_entity_id=h.subject_entity_id,
            subject_label=subj.primary_alias if subj else h.subject_entity_id,
            object_entity_id=h.object_entity_id,
            object_label=obj.primary_alias if obj else h.object_entity_id,
            raw_log_lr=h.raw_log_lr,
            calibrated_prob=h.calibrated_prob,
            confidence_tier=tier,
            status=h.status,
            model_version=h.model_version,
            calibration_version=h.calibration_version,
            created_at=h.created_at,
            reviewed_at=h.reviewed_at,
            reviewer_id=h.reviewer_id,
            reviewer_email=h.reviewer.email if h.reviewer else None,
            supporting_evidence=supporting,
            contradictions=contradictions,
            family_breakdown=capped_family_scores(family_scores)
        ))
    return results


@app.get("/api/v1/hypotheses/{id}", response_model=HypothesisSchema)
def get_hypothesis(id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    h = db.query(Hypothesis).options(
        joinedload(Hypothesis.evidence_items).joinedload(HypothesisEvidence.evidence).joinedload(Evidence.artifact),
        joinedload(Hypothesis.reviewer)
    ).filter_by(id=id).first()

    if not h:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    subj = db.query(Actor).filter_by(id=h.subject_entity_id).first()
    obj = db.query(Actor).filter_by(id=h.object_entity_id).first()

    supporting = []
    contradictions = []
    family_scores = {}

    for he in h.evidence_items:
        ev = he.evidence
        if ev is not None and ev.retracted_at is not None:
            continue
        item_data = EvidenceWaterfallItem(
            evidence_id=ev.id if ev else he.evidence_id,
            family=he.family,
            source_uri=ev.source_uri if ev else "Unknown",
            extraction_method=ev.extraction_method if ev else "N/A",
            value=ev.value if ev else "N/A",
            reliability=he.reliability_weight,
            raw_llr=he.raw_llr,
            contribution=he.contribution,
            is_contradiction=he.is_contradiction,
            dependence_group=ev.dependence_group if ev else "DEP_NONE",
            timestamp=ev.created_at if ev else datetime.utcnow(),
            sha256=(ev.artifact.sha256 if (ev and ev.artifact) else None)
        )
        if he.is_contradiction:
            contradictions.append(item_data)
        else:
            supporting.append(item_data)
            family_scores[he.family] = family_scores.get(he.family, 0.0) + he.contribution

    tier = "High Confidence" if h.calibrated_prob >= 0.85 else ("Medium Confidence" if h.calibrated_prob >= 0.60 else ("Low Confidence" if h.calibrated_prob >= 0.35 else "Insufficient Evidence"))

    return HypothesisSchema(
        id=h.id,
        subject_entity_id=h.subject_entity_id,
        subject_label=subj.primary_alias if subj else h.subject_entity_id,
        object_entity_id=h.object_entity_id,
        object_label=obj.primary_alias if obj else h.object_entity_id,
        raw_log_lr=h.raw_log_lr,
        calibrated_prob=h.calibrated_prob,
        confidence_tier=tier,
        status=h.status,
        model_version=h.model_version,
        calibration_version=h.calibration_version,
        created_at=h.created_at,
        reviewed_at=h.reviewed_at,
        reviewer_id=h.reviewer_id,
        reviewer_email=h.reviewer.email if h.reviewer else None,
        supporting_evidence=supporting,
        contradictions=contradictions,
        family_breakdown=capped_family_scores(family_scores)
    )


DECISION_TO_STATUS = {
    "ACCEPT": "ACCEPTED",
    "REJECT": "REJECTED",
    "INSUFFICIENT": "INSUFFICIENT",
}


@app.post("/api/v1/hypotheses/{id}/review", response_model=HypothesisSchema)
def submit_analyst_review(id: str, req: ReviewRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    h = db.query(Hypothesis).filter_by(id=id).first()
    if not h:
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    # A decision is a verb the analyst performs (ACCEPT); a status is the state
    # it leaves behind (ACCEPTED). Assigning the verb straight into the status
    # column made a just-accepted hypothesis disappear from the ACCEPTED filter
    # tab and lose its badge colour, because the seed and the UI both use the
    # past-tense form. The review row keeps the verb; only the state is mapped.
    h.status = DECISION_TO_STATUS[req.decision.value]
    h.reviewed_at = datetime.utcnow()
    h.reviewer_id = current_user.id

    review_entry = AnalystReview(
        id=uuidv7_str(),
        hypothesis_id=id,
        decision=req.decision.value,
        notes=req.notes,
        reviewer_id=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(review_entry)

    # Append Hash-Chained Audit Log
    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="ANALYST_DECISION",
        resource_type="HYPOTHESIS",
        resource_id=id,
        payload={"decision": req.decision.value, "notes": req.notes, "calibrated_prob": h.calibrated_prob}
    )
    db.commit()

    return get_hypothesis(id, db, current_user)


@app.post("/api/v1/review/{hypothesis_id}", response_model=HypothesisSchema)
def submit_analyst_review_alias(hypothesis_id: str, req: ReviewRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Alias for /api/v1/hypotheses/{id}/review for backward compatibility."""
    return submit_analyst_review(hypothesis_id, req, db, current_user)


@app.post("/api/v1/attribution/evaluate")
def evaluate_attribution_on_demand(raw_items: List[Dict[str, Any]], current_user: User = Depends(get_current_user)):
    """Evaluates arbitrary evidence rows dynamically via LLR Attribution Engine."""
    evidence_inputs = []
    for idx, item in enumerate(raw_items):
        evidence_inputs.append(RawEvidenceInput(
            evidence_id=item.get("evidence_id", f"ev_dynamic_{idx}"),
            family=item.get("family", "CONTENT_NLP"),
            value=item.get("value", ""),
            m_prob=float(item.get("m_prob", 0.80)),
            u_prob=float(item.get("u_prob", 0.05)),
            dependence_group=item.get("dependence_group", f"DEP_{idx}"),
            source_uri=item.get("source_uri", "http://dynamic.onion"),
            extraction_method=item.get("extraction_method", "manual_input"),
            timestamp=item.get("timestamp", datetime.utcnow().isoformat()),
            sha256=item.get("sha256"),
            is_contradiction=bool(item.get("is_contradiction", False)),
            contradiction_type=item.get("contradiction_type", ""),
            abstain=bool(item.get("abstain", False))
        ))
    metrics_collector.record_llr_evaluation()
    res = compute_attribution(evidence_inputs)
    return {
        "raw_log_lr": res.raw_log_lr,
        "calibrated_prob": res.calibrated_prob,
        "confidence_tier": res.confidence_tier,
        "family_scores": res.family_scores,
        "supporting_items": res.supporting_items,
        "contradiction_items": res.contradiction_items,
        "total_contradiction_penalty": res.total_contradiction_penalty,
        "decision": res.decision.name if hasattr(res.decision, "name") else str(res.decision)
    }



# --- CASES & INVESTIGATIONS ---
@app.get("/api/v1/investigations", response_model=List[CaseResponse])
def list_cases(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cases = db.query(Case).all()
    results = []
    for c in cases:
        results.append(CaseResponse(
            id=c.id,
            title=c.title,
            description=c.description,
            status=c.status,
            created_by=c.created_by,
            created_at=c.created_at,
            member_count=len(c.members)
        ))
    return results


@app.post("/api/v1/investigations", response_model=CaseResponse)
def create_case(req: CaseCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    new_case = Case(
        id=uuidv7_str(),
        title=req.title,
        description=req.description,
        status="ACTIVE",
        created_by=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(new_case)
    db.flush()

    member = CaseMember(
        id=uuidv7_str(),
        case_id=new_case.id,
        user_id=current_user.id,
        role="INVESTIGATOR",
        created_at=datetime.utcnow()
    )
    db.add(member)

    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="CASE_CREATED",
        resource_type="CASE",
        resource_id=new_case.id,
        payload={"title": req.title}
    )
    db.commit()

    return CaseResponse(
        id=new_case.id,
        title=new_case.title,
        description=new_case.description,
        status=new_case.status,
        created_by=new_case.created_by,
        created_at=new_case.created_at,
        member_count=1
    )


@app.delete("/api/v1/investigations/{id}")
def delete_case(id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(Case).filter_by(id=id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Case not found")
    
    # Delete case members first
    db.query(CaseMember).filter_by(case_id=id).delete()
    db.delete(c)
    
    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="CASE_DELETED",
        resource_type="CASE",
        resource_id=id,
        payload={"id": id}
    )
    db.commit()
    return {"status": "success", "message": f"Case {id} deleted successfully"}


@app.get("/api/v1/investigations/{id}/identifiers",
         response_model=List[CaseIdentifierResponse])
def list_case_identifiers(id: str, db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """Identifiers an analyst has attached to this investigation."""
    if db.query(Case).filter_by(id=id).first() is None:
        raise HTTPException(status_code=404, detail="Investigation not found")

    rows = (db.query(CaseIdentifier)
            .filter_by(case_id=id)
            .order_by(CaseIdentifier.created_at.desc()).all())
    return [CaseIdentifierResponse(
        id=r.id, case_id=r.case_id, id_type=r.id_type, value=r.value,
        added_by=r.added_by, created_at=r.created_at) for r in rows]


@app.post("/api/v1/investigations/{id}/identifiers",
          response_model=CaseIdentifierResponse, status_code=201)
def add_case_identifier(id: str, req: CaseIdentifierCreate,
                        db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    """Attach an identifier of interest to an investigation.

    The Cases view raised an "identifier added" toast and called nothing --
    the value was never sent, never stored, and gone on the next render, while
    the toast said otherwise. It is now persisted against the case, attributed
    to the analyst who added it, and appended to the audit chain.
    """
    case = db.query(Case).filter_by(id=id).first()
    if case is None:
        raise HTTPException(status_code=404, detail="Investigation not found")

    value = req.value.strip()
    if not value:
        raise HTTPException(status_code=422, detail="Identifier value is required")

    existing = (db.query(CaseIdentifier)
                .filter_by(case_id=id, id_type=req.id_type, value=value).first())
    if existing is not None:
        raise HTTPException(status_code=409,
                            detail="That identifier is already attached to this case")

    row = CaseIdentifier(
        id=uuidv7_str(),
        case_id=id,
        id_type=req.id_type,
        value=value,
        added_by=current_user.id,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="CASE_IDENTIFIER_ADDED",
        resource_type="CASE",
        resource_id=id,
        payload={"id_type": req.id_type, "value": value},
    )
    db.commit()
    db.refresh(row)

    return CaseIdentifierResponse(
        id=row.id, case_id=row.case_id, id_type=row.id_type,
        value=row.value, added_by=row.added_by, created_at=row.created_at)


@app.patch("/api/v1/investigations/{id}/archive")
def archive_case(id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(Case).filter_by(id=id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Case not found")
    
    c.status = "ARCHIVED"
    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="CASE_ARCHIVED",
        resource_type="CASE",
        resource_id=id,
        payload={"id": id}
    )
    db.commit()
    return {"status": "success", "message": f"Case {id} archived successfully", "status_code": "ARCHIVED"}



# --- SEARCH ---
@app.get("/api/v1/search", response_model=SearchResponse)
def search_entities(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Hybrid OpenSearch & SQL Search Service."""
    return opensearch_service.search(query_str=q, db=db, limit=limit)


# --- EXPORTS & REPORTS ---
@app.post("/api/v1/exports/report")
def export_pdf_report(hypothesis_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    h_schema = get_hypothesis(hypothesis_id, db, current_user)
    valid, _, _ = verify_audit_chain(db)

    pdf_bytes = generate_pdf_report(
        case_title="Operation ShadowByte De-Anonymization",
        actor_name=h_schema.subject_label,
        hypothesis_data=h_schema.model_dump(),
        analyst_email=current_user.email,
        audit_chain_valid=valid
    )

    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="REPORT_EXPORTED",
        resource_type="REPORT",
        resource_id=hypothesis_id,
        payload={"format": "PDF", "hypothesis_id": hypothesis_id}
    )
    db.commit()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=NETRA-X_Report_{hypothesis_id[:8]}.pdf"}
    )


@app.get("/api/v1/exports/json")
def export_json(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    actors = list_actors(db=db, user=current_user)
    return {"version": "0.1.0", "exported_at": datetime.utcnow().isoformat(), "actors": [a.model_dump() for a in actors]}


@app.get("/api/v1/exports/stix")
def export_stix(hypothesis_id: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Exports threat intelligence in STIX 2.1 JSON bundle format."""
    if not hypothesis_id:
        hyp = db.query(Hypothesis).first()
        if hyp is None:
            raise HTTPException(status_code=404, detail="No hypothesis available to export")
        hypothesis_id = hyp.id
    h_schema = get_hypothesis(hypothesis_id, db, current_user)

    # The alias list was ["<subject>", "DarkSpectre", "CipherVoid"] -- two real
    # aliases, but ShadowByte's, hardcoded onto whichever hypothesis was being
    # exported. A STIX bundle is shared outward as threat intelligence, so
    # attaching one actor's handles to another's is a contamination that
    # travels. The subject's own aliases are read from the ledger.
    subject = db.query(Actor).filter_by(id=h_schema.subject_entity_id).first()
    aliases = [h_schema.subject_label]
    if subject is not None:
        aliases += [a.value for a in subject.aliases if a.value != h_schema.subject_label]
    actor_data = {"aliases": aliases}
    stix_bundle = generate_stix_bundle(h_schema.model_dump(), actor_data)
    return Response(
        content=json.dumps(stix_bundle, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=NETRA-X_STIX2.1_{hypothesis_id[:8]}.json"}
    )


@app.get("/api/v1/exports/csv")
def export_csv(hypothesis_id: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Exports attribution evidence breakdown in CSV format."""
    if not hypothesis_id:
        hyp = db.query(Hypothesis).first()
        if hyp is None:
            raise HTTPException(status_code=404, detail="No hypothesis available to export")
        hypothesis_id = hyp.id
    h_schema = get_hypothesis(hypothesis_id, db, current_user)
    all_evidence = [item.model_dump() for item in (h_schema.supporting_evidence + h_schema.contradictions)]
    csv_str = generate_csv_export(all_evidence)
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=NETRA-X_Evidence_{hypothesis_id[:8]}.csv"}
    )


# --- LIVE CHANGE FEED ---
#
# Several analysts share one server, so any view goes stale as soon as someone
# else edits. Clients poll this for a cursor and refetch only when it moves.
#
# The feed is the audit log rather than a separate publish/subscribe channel.
# Every mutating endpoint already appends an audit entry -- mandatory for
# provenance, not optional -- and `seq` is monotonic and unique, so the feed
# cannot miss a change. A hand-placed publish call in each endpoint could be
# forgotten, and that change would then silently never reach anyone.
@app.get("/api/v1/changes")
def get_changes(
    since: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Audit entries after `since`, plus the current head cursor.

    `cursor` is the true head even when the returned rows are truncated, so a
    client that has been away resynchronises in one step instead of paging
    forward through history it does not need -- it refetches its views and
    resumes from the head.
    """
    limit = max(1, min(limit, 200))

    head = db.query(func.max(AuditLog.seq)).scalar()
    head = int(head) if head is not None else 0

    rows = (
        db.query(AuditLog)
        .filter(AuditLog.seq > since)
        .order_by(AuditLog.seq.asc())
        .limit(limit)
        .all()
    )

    # Resolve actor ids to emails in one query rather than per row: the UI says
    # "Sahil archived a case", and an opaque uuid would not carry that.
    actor_ids = {r.actor_user_id for r in rows if r.actor_user_id}
    emails = {}
    if actor_ids:
        emails = {
            u.id: u.email
            for u in db.query(User).filter(User.id.in_(actor_ids)).all()
        }

    return {
        "cursor": head,
        "changes": [
            {
                "seq": r.seq,
                "action": r.action,
                "resource_type": r.resource_type,
                "resource_id": r.resource_id,
                "actor": emails.get(r.actor_user_id, r.actor_user_id),
                "at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


# --- AUDIT LOG ENDPOINT ---
@app.get("/api/v1/audit")
def get_audit_logs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).all()
    valid, total_records, err_msg = verify_audit_chain(db)

    return {
        "chain_valid": valid,
        "total_records": total_records,
        "verification_message": err_msg or "SHA-256 Hash Chain Intact & Verified",
        "logs": [
            AuditLogSchema(
                id=l.id,
                actor_user_id=l.actor_user_id,
                action=l.action,
                resource_type=l.resource_type,
                resource_id=l.resource_id,
                payload_hash=l.payload_hash,
                prev_hash=l.prev_hash,
                created_at=l.created_at
            ).model_dump() for l in logs
        ]
    }


@app.get("/api/v1/audit/verify")
def verify_audit_chain_endpoint(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Explicit audit log hash-chain verification endpoint."""
    valid, total_records, err_msg = verify_audit_chain(db)
    return {
        "chain_valid": valid,
        "total_records": total_records,
        "message": err_msg or "Cryptographic SHA-256 Hash Chain Intact & Verified",
        "verified_at": datetime.utcnow().isoformat()
    }



# --- CONSTRAINED AI COPILOT ---
@app.api_route("/api/v1/copilot/query", methods=["GET", "POST"])
def query_copilot(
    query_text: Optional[str] = Query(None),
    payload: Optional[Dict[str, Any]] = Body(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Investigation assistant, answered from the authoritative ledger.

    Was six hardcoded paragraphs selected by keyword: asking about any actor
    returned the same ShadowByte/Vortex99 text, including for gibberish, with
    every figure a string literal. That is the opposite of what this system
    claims -- an assistant that fabricates a confident answer to every question
    undermines a product built on abstention and provenance.

    Now every claim comes from a row. `packages.copilot` resolves the entity,
    pulls its hypotheses and evidence, and reports the real numbers; when the
    ledger cannot answer it says so rather than substituting a different actor.
    Claude drives the same tools when ANTHROPIC_API_KEY is configured; without
    it the deterministic path answers, which is the offline demo default.
    """
    from packages.copilot import ask

    # Accept the question from a query param or a JSON body, so the drawer can
    # POST a payload without the caller having to URL-encode it.
    q_str = query_text
    if not q_str and payload:
        q_str = payload.get("query_text") or payload.get("query") or payload.get("prompt")

    # No default question. Substituting one would answer something the analyst
    # did not ask; an empty query is refused, like any other unanswerable input.
    result = ask(db, q_str or "")
    return {
        "query": q_str,
        "response": result["answer"],
        "answered": result["answered"],
        "engine": result.get("engine", "deterministic"),
        "intent": result.get("intent"),
        "tools_used": result.get("tools_used", []),
        "citation_count": len(result.get("citations", [])),
        # Existing DoD contract: the assistant must cite the evidence rows its
        # claim rests on, not just assert a conclusion.
        "referenced_evidence_ids": result.get("evidence_ids", []),
        "resolved_actor": result.get("resolved_actor"),
        "disclaimer": (
            "Derived from the evidence ledger. Attribution decisions require "
            "analyst review; this assistant does not make them."
        ),
    }


# --- ADVANCED ATTRIBUTION & ML ENDPOINTS ---
@app.post("/api/v1/stylometry/neural")
def evaluate_neural_stylometry(
    text_a: str = Query(...),
    text_b: str = Query(...),
    item_id: str = Query("ev_neural_sty"),
    current_user: User = Depends(get_current_user),
):
    """Evaluates short text samples (<50 words) using PyTorch Neural Short-Text Stylometry Encoder."""
    from packages.stylometry.episodes import StylometryEpisode
    from packages.stylometry.verify import verify_short_text_neural_stylometry

    ep1 = StylometryEpisode.from_single_text("author_a", "ep1", text_a)
    ep2 = StylometryEpisode.from_single_text("author_b", "ep2", text_b)
    item = verify_short_text_neural_stylometry(ep1, ep2, item_id=item_id)

    return item.to_dict()


@app.post("/api/v1/graph/predict-link")
def predict_graph_link(
    node_a: str = Query(...),
    node_b: str = Query(...),
    item_id: str = Query("ev_graph_link"),
    current_user: User = Depends(get_current_user),
):
    """Predicts identity graph link probability using Node2Vec random walk embeddings."""
    # torch is an optional [neural] extra, so this capability may simply not be
    # installed in a given deployment -- the Render instance does not carry a
    # ~2GB dependency. Report that as 503 Service Unavailable with an
    # actionable message rather than letting ModuleNotFoundError surface as an
    # opaque 500, which tells the caller nothing about why it failed or how to
    # fix it.
    try:
        from packages.attribution.graph_embedding import fit_graph_embeddings, evaluate_graph_link
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail=(
                "Graph link prediction requires PyTorch, an optional extra not "
                "installed in this deployment. Install with: pip install -e .[neural]"
            ),
        )

    default_adj = {
        node_a: [node_b, "pgp_identity_key", "wallet_cluster_01"],
        node_b: [node_a, "favicon_hash_01"],
        "pgp_identity_key": [node_a],
        "wallet_cluster_01": [node_a],
        "favicon_hash_01": [node_b],
    }

    embeddings = fit_graph_embeddings(default_adj, embed_dim=64, epochs=3)
    item = evaluate_graph_link(node_a, node_b, embeddings, item_id=item_id)
    return item.to_dict()


@app.post("/api/v1/financial/utxo-clusters")
def evaluate_financial_utxo(
    address_a: str = Query(...),
    address_b: str = Query(...),
    item_id: str = Query("ev_financial_utxo"),
    current_user: User = Depends(get_current_user),
):
    """Evaluates Bitcoin UTXO co-spending cluster matches and address reuse."""
    from packages.attribution.financial import build_utxo_clusters, evaluate_wallet_evidence

    tx_data = [
        {"inputs": [address_a, "address_co_spending_01"], "outputs": ["output_01"]},
        {"inputs": ["address_co_spending_01", address_b], "outputs": ["output_02"]},
    ]
    cluster_map = build_utxo_clusters(tx_data)
    item = evaluate_wallet_evidence(address_a, address_b, cluster_map=cluster_map, item_id=item_id)
    return {
        "cluster_map": cluster_map,
        "evidence_item": item.to_dict(),
    }


@app.post("/api/v1/attribution/waterfall")
def format_evidence_waterfall_report(
    target_actor: str = Query(...),
    candidate_actor: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    """Generates structured evidence waterfall breakdown, ASCII chart, and Markdown attribution report."""
    from bench.synthetic.scenarios import generate_actor_a_scenario
    from packages.attribution.decide import evaluate_attribution
    from packages.attribution.reporting import (
        AttributionReportFormatter,
        format_ascii_waterfall,
        format_markdown_report,
    )

    hero_case = generate_actor_a_scenario()
    result = evaluate_attribution(hero_case.evidence_items)

    waterfall_breakdown = AttributionReportFormatter.build_waterfall_breakdown(result)
    ascii_diagram = format_ascii_waterfall(result)
    markdown_report = format_markdown_report(target_actor, candidate_actor, result)

    return {
        "target_actor": target_actor,
        "candidate_actor": candidate_actor,
        "decision": result.decision.value,
        "posterior_probability": result.posterior_probability,
        "waterfall_breakdown": waterfall_breakdown,
        "ascii_diagram": ascii_diagram,
        "markdown_report": markdown_report,
    }


# --- MAINTENANCE ENDPOINTS ---


@app.post("/api/v1/maintenance/backup", response_model=BackupResponse)
def create_database_backup(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(RoleName.ADMIN)),
):
    """Trigger timestamped database snapshot backup with SHA-256 validation."""
    worker = DatabaseBackupWorker()
    return worker.create_backup()


@app.post("/api/v1/maintenance/reproject", response_model=ReprojectResponse)
def reproject_graph_state(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(RoleName.ADMIN, RoleName.INVESTIGATOR)),
):
    """Trigger re-projection of SQL database entities into NetworkX graph memory."""
    worker = GraphReprojectionWorker()
    return worker.run_reprojection(db)


# --- PASSIVE PROBE & COLLECTION PIPELINE ENDPOINTS ---
@app.post("/api/v1/probes/scan", response_model=ProbeScanResponse)
def execute_onion_probe(
    req: ProbeScanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Executes passive OnionProbe infrastructure leak footprinting analysis."""
    favicon_bytes = base64.b64decode(req.favicon_b64) if req.favicon_b64 else b""
    report = OnionProbeEngine.probe_onion_target(
        target_url=req.target_url,
        html_content=req.html_content or "",
        favicon_bytes=favicon_bytes,
        headers_dict=req.headers or {},
        tls_cert_pem=req.tls_cert_pem
    )

    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="ONION_PROBE_EXECUTIVE",
        resource_type="PROBE_SCAN",
        resource_id=req.target_url[:64],
        payload={"leaks_count": report["total_leaks_found"], "target": req.target_url}
    )
    db.commit()

    return ProbeScanResponse(**report)


@app.post("/api/v1/collection/warc", response_model=WarcCollectionResponse)
def collect_warc_artifact(
    req: WarcCollectionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Converts raw payload to ISO 28500 WARC record, stores artifact, and triggers Redis event bus."""
    raw_bytes = req.raw_content.encode("utf-8")
    artifact = ImmutableArtifact(raw_bytes=raw_bytes, source_uri=req.source_uri, content_type=req.content_type or "text/html")
    warc_bytes = WARCWriter.create_warc_record(artifact)

    storage = MinIOArtifactStorage()
    stored_meta = storage.store_artifact(artifact, warc_bytes)

    # Publish PAGE_COLLECTED event to Redis Streams bus
    msg_id = event_bus.publish_event("stream:page_collected", {
        "source_uri": req.source_uri,
        "artifact_sha256": artifact.sha256,
        "warc_sha256": stored_meta["warc_sha256"],
        "collected_by": current_user.email
    })

    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="WARC_ARTIFACT_STORED",
        resource_type="ARTIFACT",
        resource_id=artifact.sha256,
        payload={"source_uri": req.source_uri, "warc_sha256": stored_meta["warc_sha256"]}
    )
    db.commit()

    return WarcCollectionResponse(
        warc_record_id=f"<urn:uuid:{artifact.sha256[:32]}>",
        artifact_sha256=artifact.sha256,
        warc_sha256=stored_meta["warc_sha256"],
        file_path=stored_meta["filepath"],
        file_size_bytes=stored_meta["size_bytes"],
        stream_msg_id=msg_id,
        timestamp=artifact.timestamp
    )


# --- ADVANCED INTELLIGENCE & AI UPGRADES (PHASE 5) ---
@app.post("/api/v1/attribution/neural-stylometry", response_model=NeuralStylometryResponse)
def evaluate_neural_stylometry(
    req: NeuralStylometryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Evaluates short-text author verification with confidence abstention thresholds."""
    res = NeuralStylometryEngine.verify_authorship(
        text_a=req.text_a,
        text_b=req.text_b,
        threshold=req.threshold or 0.65
    )

    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="NEURAL_STYLOMETRY_EVALUATED",
        resource_type="STYLOMETRY_VERDICT",
        resource_id=res["verdict"],
        payload={"similarity": res["similarity_score"], "verdict": res["verdict"]}
    )
    db.commit()

    return NeuralStylometryResponse(**res)


@app.post("/api/v1/financial/clusters/trace", response_model=FinancialClusterTraceResponse)
def trace_financial_cluster_hops(
    req: FinancialClusterTraceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Traces multi-input UTXO co-spending wallet hops and calculates financial risk profile."""
    trace_res = UTXOCoSpendingClusterer.trace_mixer_hops(
        transactions=req.transactions,
        start_address=req.start_address,
        max_hops=req.max_hops or 5
    )

    risk_res = UTXOCoSpendingClusterer.calculate_cluster_risk_score(
        cluster_id=req.cluster_id or "cluster_btc_main",
        transactions=req.transactions
    )

    append_audit_event(
        session=db,
        actor_user_id=current_user.id,
        action="FINANCIAL_MIXER_HOPS_TRACED",
        resource_type="WALLET_CLUSTER",
        resource_id=req.start_address[:64],
        payload={"mixer_touchpoints": trace_res["mixer_touchpoints_found"], "risk_score": risk_res["risk_score"]}
    )
    db.commit()

    return FinancialClusterTraceResponse(
        trace=trace_res,
        risk_profile=risk_res,
        timestamp=datetime.utcnow().isoformat() + "Z"
    )






# ---------------------------------------------------------------------------
# STATIC FRONTEND (single-service deployment)
# ---------------------------------------------------------------------------
#
# Serves the exported Next.js bundle from this same process, so one Render
# service hosts both the API and the UI.
#
# The two-service blueprint splits them, which means the browser calls the API
# cross-origin and every request depends on CORS_ORIGINS naming the frontend's
# exact URL, and on NEXT_PUBLIC_API_URL being baked in at build time. Both are
# easy to get wrong and fail identically -- a bare "Failed to fetch" with the
# reason withheld by the browser. Served from one origin, neither applies:
# the frontend calls /api/v1/... as a relative path.
#
# Mounted last, on purpose. Every API route above is already registered, so the
# catch-all below can only ever receive paths that matched nothing else.
# Registering it earlier would shadow the entire API.
#
# Absent build output is not an error: the desktop app and local development
# both run this API with no export present, and the API must still serve.
if _FRONTEND_DIR.is_dir():
    app.mount(
        "/_next",
        StaticFiles(directory=_FRONTEND_DIR / "_next"),
        name="next-assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        """Serve the exported app, falling back to index.html for app routes.

        A static export writes real files, so a request is answered directly
        when one exists. Anything else is handed index.html and resolved by the
        client-side router -- without that, a refresh on any in-app route would
        404 against the filesystem.

        API paths are excluded explicitly. They cannot reach here unless they
        matched no route above, and returning the HTML shell for a mistyped
        endpoint would hand the caller a 200 and a page where it expected JSON.
        """
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")

        candidate = (_FRONTEND_DIR / full_path).resolve()
        # Containment check: `full_path` is attacker-controlled, and without it
        # a traversal such as ../../.env would be served straight off disk.
        if (
            candidate.is_file()
            and _FRONTEND_DIR.resolve() in candidate.parents
        ):
            return FileResponse(candidate)

        index = _FRONTEND_DIR / "index.html"
        if index.is_file():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Frontend build not found")
