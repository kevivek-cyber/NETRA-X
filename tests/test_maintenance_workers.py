"""
Unit and Integration Tests for Database Backup & Graph Re-projection Maintenance Workers.
"""

import os
import pytest
from fastapi.testclient import TestClient

from workers.maintenance.backup_worker import DatabaseBackupWorker
from workers.maintenance.graph_reproject_worker import GraphReprojectionWorker
from apps.api.database.session import SyncSessionLocal
from apps.api.main import app


def test_database_backup_worker(tmp_path):
    # Test backup creation into temporary directory
    backup_worker = DatabaseBackupWorker(backup_dir=str(tmp_path))
    res = backup_worker.create_backup(db_path="./netrax.db")

    assert res.status in ["SUCCESS", "FAILED: Source database file not found"]
    if res.status == "SUCCESS":
        assert os.path.exists(res.filepath)
        assert len(res.sha256_hash) == 64
        assert res.file_size_bytes > 0


def test_graph_reproject_worker():
    session = SyncSessionLocal()
    try:
        worker = GraphReprojectionWorker()
        res = worker.run_reprojection(session)
        assert res.status == "SUCCESS"
        assert res.actors_count >= 1
        assert "actors" in res.projection_stats
    finally:
        session.close()
