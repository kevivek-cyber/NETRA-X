"""
Unit and API Integration Tests for Role-Based Access Control (RBAC).
Verifies fine-grained role permissions and endpoint security.
"""

import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI, Depends, HTTPException

from packages.schemas.models import RoleName
from packages.evidence.rbac import has_permission, require_roles, check_permission
from apps.api.database.models import User
from apps.api.main import app


def test_rbac_permission_matrix():
    # ADMIN has wildcard access
    assert has_permission(RoleName.ADMIN.value, "delete_everything") is True
    assert has_permission(RoleName.ADMIN.value, "read") is True

    # INVESTIGATOR permissions
    assert has_permission(RoleName.INVESTIGATOR.value, "create_case") is True
    assert has_permission(RoleName.INVESTIGATOR.value, "reproject_graph") is True
    assert has_permission(RoleName.INVESTIGATOR.value, "admin_backup") is False

    # ANALYST permissions
    assert has_permission(RoleName.ANALYST.value, "review_hypothesis") is True
    assert has_permission(RoleName.ANALYST.value, "create_case") is False

    # VIEWER permissions
    assert has_permission(RoleName.VIEWER.value, "read") is True
    assert has_permission(RoleName.VIEWER.value, "review_hypothesis") is False

    # Invalid role returns False gracefully
    assert has_permission("INVALID_ROLE", "read") is False


def test_rbac_require_roles_dependency():
    test_app = FastAPI()

    @test_app.get("/admin-only", dependencies=[Depends(require_roles(RoleName.ADMIN))])
    def admin_endpoint():
        return {"status": "ok"}

    client = TestClient(test_app)

    # Test missing auth/user dependency handling
    response = client.get("/admin-only")
    assert response.status_code in [401, 403, 422]


def test_rbac_maintenance_endpoints_access():
    client = TestClient(app)

    # Login as default analyst user
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "analyst@netra-x.local", "password": "AnalystPass2026!"}
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # ANALYST attempting ADMIN-only backup endpoint must receive 403 Forbidden
    backup_resp = client.post("/api/v1/maintenance/backup", headers=headers)
    assert backup_resp.status_code == 403
    assert "Access denied" in backup_resp.json()["detail"]
