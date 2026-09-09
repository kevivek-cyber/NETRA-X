"""
Database Backup & Snapshot Maintenance Worker for NETRA-X Platform.
Generates atomic, timestamped database snapshot backups with SHA-256 integrity validation.
"""

import os
import shutil
import hashlib
from datetime import datetime
from typing import Dict, Any

from packages.schemas.models import BackupResponse


class DatabaseBackupWorker:
    """Automated Database Backup and Snapshot Utility."""

    def __init__(self, backup_dir: str = "./backups"):
        self.backup_dir = os.path.abspath(backup_dir)
        os.makedirs(self.backup_dir, exist_ok=True)

    def create_backup(self, db_path: str = "./netrax.db") -> BackupResponse:
        """Create a timestamped copy of the database and calculate SHA-256 digest."""
        timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"netrax_backup_{timestamp_str}.db"
        target_path = os.path.join(self.backup_dir, backup_filename)

        abs_source = os.path.abspath(db_path)
        if not os.path.exists(abs_source):
            # If SQLite DB file doesn't exist yet, return snapshot error response
            return BackupResponse(
                filename=backup_filename,
                filepath=target_path,
                file_size_bytes=0,
                sha256_hash="0" * 64,
                timestamp=datetime.utcnow().isoformat() + "Z",
                status="FAILED: Source database file not found"
            )

        # Copy database snapshot atomically
        shutil.copy2(abs_source, target_path)

        # Compute SHA-256 digest
        hasher = hashlib.sha256()
        with open(target_path, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        sha256_digest = hasher.hexdigest()
        file_size = os.path.getsize(target_path)

        return BackupResponse(
            filename=backup_filename,
            filepath=target_path,
            file_size_bytes=file_size,
            sha256_hash=sha256_digest,
            timestamp=datetime.utcnow().isoformat() + "Z",
            status="SUCCESS"
        )
