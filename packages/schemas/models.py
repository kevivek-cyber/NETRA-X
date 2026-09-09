"""
Shared Pydantic Schemas for NETRA-X Platform
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class RoleName(str, Enum):
    ADMIN = "ADMIN"
    INVESTIGATOR = "INVESTIGATOR"
    ANALYST = "ANALYST"
    RESEARCHER = "RESEARCHER"
    VIEWER = "VIEWER"


ROLE_PERMISSIONS: Dict[RoleName, List[str]] = {
    RoleName.ADMIN: ["*"],
    RoleName.INVESTIGATOR: [
        "read", "create_case", "edit_case", "ingest_evidence", "review_hypothesis",
        "evaluate_attribution", "export_report", "reproject_graph"
    ],
    RoleName.ANALYST: [
        "read", "review_hypothesis", "evaluate_attribution", "export_report", "search"
    ],
    RoleName.RESEARCHER: [
        "read", "evaluate_attribution", "search"
    ],
    RoleName.VIEWER: [
        "read", "search"
    ]
}



class CaseStatus(str, Enum):
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"
    CLOSED = "CLOSED"


class HypothesisStatus(str, Enum):
    """States a hypothesis can rest in.

    ACCEPT/REJECT were also members here -- the decision verbs, admitted
    because the review endpoint wrote `req.decision.value` straight into the
    status column. That let a just-accepted hypothesis sit in state "ACCEPT",
    which no filter tab and no badge colour matched. The verbs live in
    DecisionEnum; only past-tense states belong in a status.
    """
    PROPOSED = "PROPOSED"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    INSUFFICIENT = "INSUFFICIENT"


class DecisionEnum(str, Enum):
    ACCEPT = "ACCEPT"
    REJECT = "REJECT"
    INSUFFICIENT = "INSUFFICIENT"


class EvidenceFamily(str, Enum):
    EXACT_IDENTITY = "Exact Identity"
    FINANCIAL = "Financial"
    INFRASTRUCTURE = "Infrastructure"
    CONTENT_NLP = "Content / NLP"
    STYLOMETRY = "Stylometry"
    TEMPORAL = "Temporal"
    SEMANTIC_HANDLE = "Semantic / Handle"


# User & Auth
class UserBase(BaseModel):
    email: str
    mfa_enabled: bool = False


class UserCreate(UserBase):
    password: str
    role: RoleName = RoleName.ANALYST


class UserResponse(UserBase):
    id: str
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class LoginRequest(BaseModel):
    email: str
    password: str


# Case
class CaseCreate(BaseModel):
    title: str
    description: Optional[str] = None


class CaseResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    status: str
    created_by: str
    created_at: datetime
    member_count: int = 1


class CaseIdentifierCreate(BaseModel):
    id_type: str = Field(..., min_length=1, max_length=50)
    value: str = Field(..., min_length=1, max_length=512)


class CaseIdentifierResponse(BaseModel):
    id: str
    case_id: str
    id_type: str
    value: str
    added_by: str
    created_at: datetime


# Entity Schemas
class AliasSchema(BaseModel):
    id: str
    actor_id: str
    value: str
    platform: Optional[str] = None
    source: str
    confidence: float


class PGPKeySchema(BaseModel):
    id: str
    fingerprint: str
    key_id: str
    actor_id: Optional[str]
    key_body: Optional[str]
    created_at: datetime


class WalletSchema(BaseModel):
    id: str
    address: str
    chain: str
    cluster_id: Optional[str]
    actor_id: Optional[str]


class OnionServiceSchema(BaseModel):
    id: str
    onion_address: str
    title: Optional[str]
    favicon_mmh3: Optional[int]
    tls_cert_fingerprint: Optional[str]
    first_seen: datetime
    last_seen: datetime


class ServerSchema(BaseModel):
    id: str
    ip_address: str
    asn: Optional[str]
    provider: Optional[str]


class ActorSchema(BaseModel):
    id: str
    primary_alias: str
    category: str
    confidence: float
    last_seen: datetime
    is_synthetic: bool = True
    aliases: List[AliasSchema] = []
    pgp_keys: List[PGPKeySchema] = []
    wallets: List[WalletSchema] = []
    onion_services: List[OnionServiceSchema] = []


# Evidence & Provenance
class EvidenceSchema(BaseModel):
    id: str
    artifact_id: str
    source_uri: str
    collector_version: str
    extraction_method: str
    value: str
    confidence: float
    dependence_group: str
    is_immutable: bool = True
    created_at: datetime
    sha256: Optional[str] = None
    # Withdrawn evidence stays in the ledger and is surfaced as retracted,
    # so the vault can show it struck through rather than making it vanish.
    retracted_at: Optional[datetime] = None
    retraction_reason: Optional[str] = None


class EvidenceWaterfallItem(BaseModel):
    evidence_id: str
    family: str
    source_uri: str
    extraction_method: str
    value: str
    reliability: float
    raw_llr: float
    contribution: float
    is_contradiction: bool
    dependence_group: str
    timestamp: datetime
    # Optional on purpose. This was a required str, so the endpoint substituted
    # e3b0c442...b855 -- the SHA-256 of the empty string -- whenever the
    # artifact was missing, displaying "no provenance" as a verified digest.
    # Absent provenance must read as absent.
    sha256: Optional[str] = None


# Hypothesis & Attribution
class HypothesisSchema(BaseModel):
    id: str
    subject_entity_id: str
    subject_label: str
    object_entity_id: str
    object_label: str
    raw_log_lr: float
    calibrated_prob: float
    confidence_tier: str
    status: HypothesisStatus
    model_version: str
    calibration_version: str
    created_at: datetime
    reviewed_at: Optional[datetime] = None
    reviewer_id: Optional[str] = None
    reviewer_email: Optional[str] = None
    supporting_evidence: List[EvidenceWaterfallItem] = []
    contradictions: List[EvidenceWaterfallItem] = []
    family_breakdown: Dict[str, float] = {}


class ReviewRequest(BaseModel):
    decision: DecisionEnum
    notes: Optional[str] = None


# Audit Log
class AuditLogSchema(BaseModel):
    id: str
    actor_user_id: str
    user_email: Optional[str] = None
    action: str
    resource_type: str
    resource_id: str
    payload_hash: str
    prev_hash: str
    created_at: datetime


# Search
class SearchResultItem(BaseModel):
    entity_id: str
    entity_type: str
    title: str
    snippet: str
    source_uri: str
    confidence: float
    provenance_hash: str


class SearchResponse(BaseModel):
    query: str
    total_matches: int
    results: List[SearchResultItem]


# Ingestion
#
# `lawful_basis` is a closed enum rather than a free string on purpose. The
# column is NOT NULL in the ledger because collection legality is a property of
# every observation, not an annotation someone may forget -- so the API refuses
# to record an observation that cannot state its basis.
class LawfulBasis(str, Enum):
    PASSIVE_OSINT = "passive_osint"
    SYNTHETIC_SEED = "synthetic_seed"
    HONEYPOT = "honeypot"


class SourceType(str, Enum):
    PASSIVE_ONION = "PASSIVE_ONION"
    FORUM_CRAWL = "FORUM_CRAWL"
    HONEYPOT = "HONEYPOT"
    SYNTHETIC = "SYNTHETIC"


class IngestRequest(BaseModel):
    raw_content: str = Field(..., min_length=1, max_length=200_000)
    source_name: str = Field(..., min_length=1, max_length=255)
    source_type: SourceType = SourceType.FORUM_CRAWL
    lawful_basis: LawfulBasis = LawfulBasis.PASSIVE_OSINT
    source_uri: Optional[str] = Field(default=None, max_length=512)


class ExtractedEvidence(BaseModel):
    id: str
    kind: str
    value: str
    dependence_group: str
    confidence: float


class IngestResponse(BaseModel):
    observation_id: str
    artifact_sha256: str
    source_id: str
    lawful_basis: str
    duplicate: bool
    extracted_count: int
    xmr_abstain: bool
    evidence: List[ExtractedEvidence]


class BackupResponse(BaseModel):
    filename: str
    filepath: str
    file_size_bytes: int
    sha256_hash: str
    timestamp: str
    status: str


class ReprojectResponse(BaseModel):
    status: str
    projection_stats: Dict[str, int]
    actors_count: int
    timestamp: str


class ProbeScanRequest(BaseModel):
    target_url: str = Field(..., min_length=1, max_length=512)
    html_content: Optional[str] = ""
    favicon_b64: Optional[str] = None
    headers: Optional[Dict[str, str]] = {}
    tls_cert_pem: Optional[str] = None


class ProbeScanResponse(BaseModel):
    target_url: str
    favicon: Dict[str, Any]
    server_status: Dict[str, Any]
    headers: Dict[str, Any]
    tls_cert: Dict[str, Any]
    total_leaks_found: int
    leaks: List[str]


class WarcCollectionRequest(BaseModel):
    raw_content: str = Field(..., min_length=1, max_length=500_000)
    source_uri: str = Field(..., min_length=1, max_length=512)
    content_type: Optional[str] = "text/html"


class WarcCollectionResponse(BaseModel):
    warc_record_id: str
    artifact_sha256: str
    warc_sha256: str
    file_path: str
    file_size_bytes: int
    stream_msg_id: str
    timestamp: str


class NeuralStylometryRequest(BaseModel):
    text_a: str = Field(..., min_length=1, max_length=50_000)
    text_b: str = Field(..., min_length=1, max_length=50_000)
    threshold: Optional[float] = 0.65


class NeuralStylometryResponse(BaseModel):
    verdict: str
    similarity_score: float
    llr_score: float
    tokens_text_a: int
    tokens_text_b: int
    reason: str
    confidence: float


class FinancialClusterTraceRequest(BaseModel):
    start_address: str = Field(..., min_length=1, max_length=256)
    transactions: List[Dict[str, Any]] = Field(default_factory=list)
    max_hops: Optional[int] = 5
    cluster_id: Optional[str] = "cluster_btc_main"


class FinancialClusterTraceResponse(BaseModel):
    trace: Dict[str, Any]
    risk_profile: Dict[str, Any]
    timestamp: str



