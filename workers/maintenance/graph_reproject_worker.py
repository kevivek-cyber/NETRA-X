"""
Graph Re-projection Maintenance Worker for NETRA-X Platform.
Synchronizes database records with NetworkX and Neo4j graph projections.
"""

from datetime import datetime
from typing import Dict, Any
from sqlalchemy.orm import Session

from packages.schemas.models import ReprojectResponse
from packages.graph.projection import GraphProjectionService
from apps.api.database.models import Actor


class GraphReprojectionWorker:
    """Worker to trigger idempotent graph state re-projections."""

    def __init__(self):
        self.projection_service = GraphProjectionService()

    def run_reprojection(self, db: Session) -> ReprojectResponse:
        """Rebuild entity-relationship graph state from SQL database."""
        stats = self.projection_service.rebuild_graph_from_postgres(db)
        actor_count = db.query(Actor).count()

        return ReprojectResponse(
            status="SUCCESS",
            projection_stats=stats,
            actors_count=actor_count,
            timestamp=datetime.utcnow().isoformat() + "Z"
        )
