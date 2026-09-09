"""
Role-Based Access Control (RBAC) Security Module for NETRA-X Platform.
Provides fine-grained role enforcement and resource authorization helpers.
"""

from typing import Callable, List, Optional, Sequence, Union
from fastapi import Depends, HTTPException, status

from packages.schemas.models import RoleName, ROLE_PERMISSIONS
from packages.evidence.auth import get_current_user
from apps.api.database.models import User


def has_permission(role: str, permission: str) -> bool:
    """Check if a given role string holds the specified permission."""
    try:
        r_enum = RoleName(role)
    except (ValueError, TypeError):
        return False

    allowed_permissions = ROLE_PERMISSIONS.get(r_enum, [])
    if "*" in allowed_permissions or permission in allowed_permissions:
        return True
    return False


def require_roles(*allowed_roles: Union[RoleName, str]):
    """
    FastAPI Dependency Factory that enforces role authorization.

    Usage:
        @app.post("/api/v1/cases", dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.INVESTIGATOR))])
        def create_case(...):
    """
    allowed_str_set = {r.value if isinstance(r, RoleName) else str(r) for r in allowed_roles}
    # Always allow ADMIN
    allowed_str_set.add(RoleName.ADMIN.value)

    def dependency(user: User = Depends(get_current_user)):
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required"
            )

        if user.role not in allowed_str_set:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. User role '{user.role}' lacks required authorization. Required: {list(allowed_str_set)}"
            )
        return user

    return dependency


def check_permission(user: User, permission: str) -> bool:
    """Verify if user has specific named permission."""
    if not user or not user.role:
        return False
    return has_permission(user.role, permission)


def enforce_permission(user: User, permission: str) -> None:
    """Raise HTTP 403 Forbidden if user lacks the specified permission."""
    if not check_permission(user, permission):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied. Required permission '{permission}' missing for role '{user.role}'."
        )
