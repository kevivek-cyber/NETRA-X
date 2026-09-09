"""
SHA-256 Hash-Chained Audit Logging Service
Ensures tamper-evident, append-only provenance for every sensitive platform action.

Each entry commits to three things:

    payload_hash = SHA256(canonical_json(payload))
    entry_hash   = SHA256(seq | prev_hash | actor | action | resource | payload_hash | created_at_us)
    prev_hash    = the previous entry's entry_hash

so editing or deleting any historical row changes its entry_hash, which no
longer matches the prev_hash recorded by the next row. Verification fails at
that point and every point after it.

What changed and why
--------------------
The previous implementation chained on `payload_hash` and verified only that
prev_hash values linked up -- it never recomputed a hash from stored data, and
the payload was discarded after hashing. Consequences:

  * Editing `action`, `actor_user_id`, `resource_id` or `created_at` on a row
    was completely undetectable: nothing was ever recomputed from those fields.
  * The payload was not stored, so `payload_hash` could not be re-derived and
    an auditor could not see what an action actually did.
  * Ordering used `created_at`, so clock skew or a clock change could reorder
    the chain and fail verification on untampered data.

`verify_audit_chain()` now recomputes both hashes from the stored row, so all
of those are caught. Its return signature is unchanged --
`(valid, count, error)` -- so existing callers and tests are unaffected.

Honest limitation
-----------------
This is tamper-*evidence*, not tamper-*proofing*. Someone with write access can
rewrite the chain from a tampered row forward and produce a self-consistent
log, and truncating entries from the end leaves a shorter but valid chain.
Catching either needs an external anchor: periodically publish `chain_head()`
somewhere the attacker does not control, and compare.
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from apps.api.database.models import AuditLog
from packages.evidence.uuid7 import uuidv7_str

GENESIS_HASH = "0" * 64

# Field separator for entry hashing. Not producible by a hex digest, an enum
# value or a UUID, so ("a","bc") and ("ab","c") cannot hash alike.
_SEP = "\x1f"

_MAX_APPEND_ATTEMPTS = 5


def canonical_json(payload: Any) -> str:
    """Deterministic JSON: sorted keys, no incidental whitespace.

    Key order must be stable or the same payload hashes differently between
    runs and verification fails spuriously. `default=str` keeps this total so
    an unusual value (datetime, UUID) degrades to its string form instead of
    raising and costing us the audit entry.
    """
    return json.dumps(
        payload if payload is not None else {},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )


def compute_payload_hash(data: Dict[str, Any]) -> str:
    """SHA-256 of the canonical payload JSON."""
    return hashlib.sha256(canonical_json(data).encode("utf-8")).hexdigest()


def _micros(ts: datetime) -> int:
    """Timestamp as integer microseconds since the Unix epoch.

    Formatting a datetime as a string invites timezone and precision drift
    between Postgres (timestamptz, microseconds) and SQLite. An integer is
    unambiguous. Naive values are read as UTC rather than rejected -- losing an
    audit entry over a missing tzinfo would be worse than assuming.
    """
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return int(ts.astimezone(timezone.utc).timestamp() * 1_000_000)


def compute_entry_hash(
    seq: int,
    prev_hash: str,
    actor_user_id: str,
    action: str,
    resource_type: str,
    resource_id: str,
    payload_hash: str,
    created_at: datetime,
) -> str:
    """Digest binding one entry's own fields to its predecessor."""
    parts = [
        str(seq),
        prev_hash,
        actor_user_id or "",
        action,
        resource_type,
        resource_id or "",
        payload_hash,
        str(_micros(created_at)),
    ]
    return hashlib.sha256(_SEP.join(parts).encode("utf-8")).hexdigest()


def _tail(session: Session) -> Tuple[int, str]:
    """(next_seq, prev_hash) for the entry about to be appended."""
    row = session.execute(
        select(AuditLog.seq, AuditLog.entry_hash).order_by(AuditLog.seq.desc()).limit(1)
    ).first()
    if row is None:
        return 0, GENESIS_HASH
    return row[0] + 1, row[1]


def append_audit_event(
    session: Session,
    actor_user_id: str,
    action: str,
    resource_type: str,
    resource_id: str,
    payload: Dict[str, Any],
) -> AuditLog:
    """Append a hash-chained audit event. Does not commit.

    The caller commits, so the audit entry lands in the same transaction as the
    action it records: a rollback must not leave an entry claiming something
    happened, and a successful action must not lose its entry.

    `seq` is UNIQUE, so concurrent writers racing for a slot collide rather
    than forking the chain; the loser re-reads the tail and retries. Retries
    are bounded -- exhausting them raises rather than writing an entry with a
    stale prev_hash.
    """
    created_at = datetime.now(timezone.utc)
    payload_hash = compute_payload_hash(payload)
    serialized = canonical_json(payload)

    last_error: Optional[Exception] = None
    for _ in range(_MAX_APPEND_ATTEMPTS):
        seq, prev_hash = _tail(session)
        entry = AuditLog(
            id=uuidv7_str(),
            seq=seq,
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            payload=serialized,
            payload_hash=payload_hash,
            prev_hash=prev_hash,
            entry_hash=compute_entry_hash(
                seq, prev_hash, actor_user_id, action,
                resource_type, resource_id, payload_hash, created_at,
            ),
            created_at=created_at,
        )
        session.add(entry)

        try:
            from apps.api.metrics import metrics_collector
            metrics_collector.record_audit_event()
        except Exception:
            pass

        try:

            session.flush()
            return entry
        except IntegrityError as exc:
            last_error = exc
            session.rollback()

    raise RuntimeError(
        f"Audit append failed after {_MAX_APPEND_ATTEMPTS} attempts: {last_error}"
    )


def verify_audit_chain(session: Session) -> Tuple[bool, int, Optional[str]]:
    """Recompute and verify the whole chain from genesis.

    Returns (valid, entries_checked, error_message) -- unchanged signature.

    Each entry is checked four ways, in the order a tamperer would have to
    defeat them:
      1. seq is contiguous          -- catches a deleted or reordered entry
      2. prev_hash matches          -- catches an altered predecessor
      3. payload_hash matches       -- catches an edited payload
      4. entry_hash matches         -- catches an edited field, or an edited
                                       payload whose hash was also updated
    """
    logs = session.execute(select(AuditLog).order_by(AuditLog.seq.asc())).scalars().all()

    if not logs:
        return True, 0, None

    expected_prev = GENESIS_HASH
    expected_seq = 0

    for index, log in enumerate(logs):
        if log.seq != expected_seq:
            return False, index, (
                f"Chain broken at record {log.id}: expected seq {expected_seq}, "
                f"found {log.seq} (an entry was deleted or inserted out of order)"
            )

        if log.prev_hash != expected_prev:
            return False, index, (
                f"Chain broken at record {log.id}: prev_hash does not match the "
                "previous entry's entry_hash (a prior entry was altered or removed)"
            )

        stored_payload = json.loads(log.payload) if log.payload else {}
        if compute_payload_hash(stored_payload) != log.payload_hash:
            return False, index, (
                f"Chain broken at record {log.id}: payload_hash does not match "
                "the stored payload (the payload was edited)"
            )

        recomputed = compute_entry_hash(
            log.seq, log.prev_hash, log.actor_user_id, log.action,
            log.resource_type, log.resource_id, log.payload_hash, log.created_at,
        )
        if recomputed != log.entry_hash:
            return False, index, (
                f"Chain broken at record {log.id}: entry_hash does not match the "
                "entry's own fields (action, actor, resource or timestamp was edited)"
            )

        expected_prev = log.entry_hash
        expected_seq = log.seq + 1

    return True, len(logs), None


def chain_head(session: Session) -> Optional[str]:
    """Current head hash -- the value to publish to an external anchor.

    Comparing a published head against the live one is the only way to detect
    truncation of the tail or a wholesale rewrite, neither of which the chain
    can catch on its own. Returns None for an empty log.
    """
    return session.execute(
        select(AuditLog.entry_hash).order_by(AuditLog.seq.desc()).limit(1)
    ).scalar_one_or_none()


def entry_count(session: Session) -> int:
    return session.execute(select(func.count()).select_from(AuditLog)).scalar_one()
