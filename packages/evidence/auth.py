"""
Authentication and JWT Token Security Utilities for NETRA-X Backend
Supports PBKDF2-HMAC-SHA256 and bcrypt password hashing, and PyJWT issuance/verification.
"""

import os
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, Optional
import jwt

JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

# Set NETRAX_ALLOW_EPHEMERAL_SECRET=1 for tests and local demos.
_ALLOW_EPHEMERAL = os.getenv("NETRAX_ALLOW_EPHEMERAL_SECRET", "").lower() in {"1", "true", "yes"}


def _resolve_secret_key() -> str:
    """Resolve the JWT signing key, auto-generating a secure ephemeral key if not specified."""
    key = os.getenv("SECRET_KEY")
    if key:
        return key

    if _ALLOW_EPHEMERAL:
        return secrets.token_urlsafe(64)

    # In cloud/container deployments where SECRET_KEY wasn't explicitly passed,
    # generate a secure random per-process key so the service starts cleanly.
    print("[!] WARNING: SECRET_KEY environment variable not found. Auto-generating ephemeral random key for this session.")
    return secrets.token_urlsafe(64)


SECRET_KEY = _resolve_secret_key()


def hash_password(password: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with random salt."""
    salt = os.urandom(16)
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    return f"pbkdf2:sha256:100000${salt.hex()}${pwd_hash.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain password against hashed representation."""
    if not hashed_password:
        return False

    if hashed_password.startswith("pbkdf2:sha256:"):
        try:
            parts = hashed_password.split("$")
            iterations = int(parts[0].split(":")[-1])
            salt = bytes.fromhex(parts[1])
            expected_hash = bytes.fromhex(parts[2])
            pwd_hash = hashlib.pbkdf2_hmac('sha256', plain_password.encode('utf-8'), salt, iterations)
            return pwd_hash == expected_hash
        except Exception:
            return False
    else:
        try:
            from passlib.context import CryptContext
            pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
            return pwd_context.verify(plain_password, hashed_password)
        except Exception:
            return False


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Issue PyJWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=JWT_ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and validate PyJWT access token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except Exception:
        return None


from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(lambda: None)) -> Any:
    """FastAPI Dependency for Current Authenticated User."""
    from apps.api.database.models import User
    from apps.api.database.session import SyncSessionLocal

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired authentication token")

    user_id = payload.get("sub")
    
    # If db is not injected, create fallback session
    session = db if hasattr(db, "query") else SyncSessionLocal()
    try:
        user = session.query(User).filter_by(id=user_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user
    finally:
        if not hasattr(db, "query"):
            session.close()

