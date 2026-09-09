"""
OpenSearch Full-Text Search Integration & Hybrid SQL Fallback Service.
Supports indexing raw darknet WARC artifacts, forum threads, and entity identifiers.
Provides graceful fallback to SQL database queries when OpenSearch is unconfigured.
"""

import os
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from packages.schemas.models import SearchResponse, SearchResultItem
from apps.api.database.models import (
    Account, Actor, Alias, Evidence, Observation, OnionService, PGPKey, Wallet,
)


class OpenSearchService:
    """Hybrid OpenSearch & Relational SQL Search Engine for NETRA-X Platform."""

    def __init__(self):
        self.opensearch_url = os.getenv("OPENSEARCH_URL")
        self.client = None
        self.is_connected = False
        self._init_opensearch_client()

    def _init_opensearch_client(self):
        """Initialize OpenSearch client if package and endpoint are available."""
        if not self.opensearch_url:
            return

        try:
            from opensearchpy import OpenSearch
            self.client = OpenSearch(
                hosts=[self.opensearch_url],
                http_compress=True,
                use_ssl=False,
                verify_certs=False,
                ssl_assert_hostname=False,
                ssl_show_warn=False,
            )
            # Test connectivity
            if self.client.ping():
                self.is_connected = True
                self._ensure_indices()
        except Exception as e:
            print(f"[!] OpenSearch initialization note: {e}. Falling back to SQL search engine.")
            self.is_connected = False

    def _ensure_indices(self):
        """Ensure required OpenSearch indices exist."""
        if not self.is_connected or not self.client:
            return

        index_name = "netrax_artifacts"
        try:
            if not self.client.indices.exists(index=index_name):
                mapping = {
                    "mappings": {
                        "properties": {
                            "artifact_sha256": {"type": "keyword"},
                            "content": {"type": "text", "analyzer": "standard"},
                            "source_name": {"type": "text"},
                            "lawful_basis": {"type": "keyword"},
                            "timestamp": {"type": "date"}
                        }
                    }
                }
                self.client.indices.create(index=index_name, body=mapping)
        except Exception as e:
            print(f"[!] OpenSearch index creation warning: {e}")

    def search(self, query_str: str, db: Session, limit: int = 50) -> SearchResponse:
        """
        Execute multi-entity search query.
        Uses OpenSearch if online; otherwise falls back to Relational DB search.
        """
        query_clean = query_str.strip()
        if not query_clean:
            return SearchResponse(query=query_str, total_matches=0, results=[])

        if self.is_connected and self.client:
            try:
                return self._search_opensearch(query_clean, limit)
            except Exception as e:
                print(f"[!] OpenSearch query failed ({e}), using SQL search engine.")

        return self._search_sql(query_clean, db, limit)

    def _search_opensearch(self, query_str: str, limit: int) -> SearchResponse:
        """Search via OpenSearch full-text cluster."""
        search_body = {
            "query": {
                "multi_match": {
                    "query": query_str,
                    "fields": ["content^3", "source_name", "artifact_sha256"],
                    "fuzziness": "AUTO"
                }
            },
            "size": limit
        }
        res = self.client.search(body=search_body, index="netrax_artifacts")
        hits = res.get("hits", {}).get("hits", [])
        
        results: List[SearchResultItem] = []
        for h in hits:
            src = h.get("_source", {})
            results.append(SearchResultItem(
                entity_id=h.get("_id", src.get("artifact_sha256", "unk")),
                entity_type="ARTIFACT",
                title=f"Darknet Artifact ({src.get('source_name', 'RAW')})",
                snippet=src.get("content", "")[:150],
                source_uri=src.get("source_uri", "netrax://warc"),
                confidence=1.0,
                provenance_hash=src.get("artifact_sha256", "N/A")
            ))

        return SearchResponse(query=query_str, total_matches=len(results), results=results)

    def _search_sql(self, query_str: str, db: Session, limit: int) -> SearchResponse:
        """Fallback Relational SQL Search Engine."""
        results: List[SearchResultItem] = []
        pattern = f"%{query_str}%"

        # 1. Search Actors (primary_alias)
        actors = db.query(Actor).filter(or_(Actor.primary_alias.ilike(pattern), Actor.category.ilike(pattern))).limit(limit).all()
        for act in actors:
            results.append(SearchResultItem(
                entity_id=act.id,
                entity_type="ACTOR_ALIAS",
                title=f"Threat Actor: {act.primary_alias}",
                snippet=f"Threat Actor '{act.primary_alias}' (Category: {act.category})",
                source_uri=f"netrax://actor/{act.id}",
                confidence=float(act.confidence or 0.9),
                provenance_hash=act.id
            ))

        # 2. Search Aliases
        aliases = db.query(Alias).filter(Alias.value.ilike(pattern)).limit(limit).all()
        for a in aliases:
            actor = db.query(Actor).filter_by(id=a.actor_id).first()
            label = actor.primary_alias if actor else a.actor_id
            results.append(SearchResultItem(
                entity_id=a.id,
                entity_type="ACTOR_ALIAS",
                title=f"Alias: {a.value}",
                snippet=f"Alias '{a.value}' ({a.platform}) linked to '{label}'",
                source_uri=f"netrax://alias/{a.id}",
                confidence=float(a.confidence or 0.85),
                provenance_hash=a.source or "N/A"
            ))

        # 3. Search PGP Keys
        pgp_keys = db.query(PGPKey).filter(or_(PGPKey.fingerprint.ilike(pattern), PGPKey.key_id.ilike(pattern))).limit(limit).all()
        for k in pgp_keys:
            actor = db.query(Actor).filter_by(id=k.actor_id).first()
            label = actor.primary_alias if actor else k.actor_id
            results.append(SearchResultItem(
                entity_id=k.id,
                entity_type="PGP_KEY",
                title=f"PGP Key: {k.key_id}",
                snippet=f"PGP Key {k.key_id} ({k.fingerprint}) associated with '{label}'",
                source_uri=f"netrax://pgp/{k.id}",
                confidence=0.99,
                provenance_hash=k.key_body[:32] if k.key_body else "N/A"
            ))

        # 4. Search Wallets
        #
        # cluster_id is matched as well as address: wallets sharing a cluster
        # were co-spent and therefore belong to the same operator, and the
        # cluster id is usually what an analyst has in hand after a chain
        # analysis pass. Address-only matching meant that link returned
        # nothing.
        wallets = db.query(Wallet).filter(
            or_(Wallet.address.ilike(pattern), Wallet.cluster_id.ilike(pattern))
        ).limit(limit).all()
        for w in wallets:
            actor = db.query(Actor).filter_by(id=w.actor_id).first()
            label = actor.primary_alias if actor else w.actor_id
            results.append(SearchResultItem(
                entity_id=w.id,
                entity_type="CRYPTO_WALLET",
                title=f"Crypto Wallet ({w.chain}): {w.address}",
                snippet=f"Wallet '{w.address}' ({w.chain}) linked to '{label}'",
                source_uri=f"netrax://wallet/{w.id}",
                confidence=0.95,
                provenance_hash=w.cluster_id or "N/A"
            ))

        # 5. Search Evidence values
        evidence = db.query(Evidence).filter(Evidence.value.ilike(pattern)).limit(limit).all()
        for e in evidence:
            results.append(SearchResultItem(
                entity_id=e.id,
                entity_type="EVIDENCE",
                title=f"Evidence: {e.extraction_method}",
                snippet=f"Extracted Evidence '{e.value}' from {e.source_uri}",
                source_uri=e.source_uri or "netrax://evidence",
                confidence=float(e.confidence or 0.8),
                provenance_hash=e.source_uri or "N/A"
            ))

        # 6. Search Accounts (forum / jabber handles)
        #
        # Restored during the merge that brought this hybrid service in. The
        # relational search it replaced covered accounts and onion services;
        # without them, searching a shared handle like "nightowl99" -- one
        # operator reusing a name across differently-named personas -- returned
        # nothing. That link is precisely the finding this product exists to
        # surface, so it must stay findable from the search bar whether or not
        # OpenSearch happens to be provisioned.
        accounts = db.query(Account).filter(Account.handle.ilike(pattern)).limit(limit).all()
        for acc in accounts:
            actor = db.query(Actor).filter_by(id=acc.actor_id).first()
            label = actor.primary_alias if actor else acc.actor_id
            results.append(SearchResultItem(
                entity_id=acc.id,
                entity_type="ACCOUNT",
                title=f"Account: {acc.handle}",
                snippet=f"Handle '{acc.handle}' on {acc.platform} linked to '{label}'",
                source_uri=f"netrax://account/{acc.id}",
                confidence=float(getattr(acc, "confidence", None) or 0.85),
                provenance_hash=acc.id,
            ))

        # 7. Search Onion Services
        onions = db.query(OnionService).filter(
            or_(OnionService.onion_address.ilike(pattern), OnionService.title.ilike(pattern))
        ).limit(limit).all()
        for o in onions:
            results.append(SearchResultItem(
                entity_id=o.id,
                entity_type="ONION_SERVICE",
                title=f"Onion: {o.onion_address}",
                snippet=f"{o.title or 'untitled'} | favicon mmh3 {o.favicon_mmh3}",
                source_uri=f"netrax://onion/{o.id}",
                confidence=0.88,
                provenance_hash=o.id,
            ))

        # Truncate to specified limit
        results = results[:limit]
        return SearchResponse(query=query_str, total_matches=len(results), results=results)


# Singleton Instance
opensearch_service = OpenSearchService()
