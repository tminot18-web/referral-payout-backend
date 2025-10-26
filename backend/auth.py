)
# backend/auth.py
import os
import bcrypt
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import jwt, JWTError
from fastapi import HTTPException, Cookie, Header, status

# ─────────────────────────────────────────────────────────────────────────────
# Env config
# ─────────────────────────────────────────────────────────────────────────────

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret")
JWT_ALG = "HS256"
# default ~30 days (in minutes)
JWT_EXPIRE_MIN = int(os.getenv("JWT_EXPIRE_MIN", "43200"))

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@example.com")

# Preferred: bcrypt hash string (e.g., from bcrypt.gensalt())
ADMIN_PASSWORD_HASH = os.getenv("ADMIN_PASSWORD_HASH", "")
# Convenience for local/dev: allow a plain password if you haven't hashed yet.
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────────────────────
# Admin verification (single admin account via env)
# ─────────────────────────────────────────────────────────────────────────────

def _verify_password(plain: str) -> bool:
    """
    Verify 'plain' matches either ADMIN_PASSWORD_HASH (bcrypt) or ADMIN_PASSWORD (raw).
    Prefer using ADMIN_PASSWORD_HASH in prod.
    """
    # bcrypt hash path (prefer)
    if ADMIN_PASSWORD_HASH:
        try:
            return bcrypt.checkpw(plain.encode(), ADMIN_PASSWORD_HASH.encode())
        except Exception:
            return False

    # raw password path (dev only)
    if ADMIN_PASSWORD:
        return plain == ADMIN_PASSWORD

    # no password configured → fail closed
    return False


def verify_admin(email: str, password: str) -> bool:
    """Return True iff (email, password) match the configured admin."""
    if email != ADMIN_EMAIL:
        return False
    return _verify_password(password)


# ─────────────────────────────────────────────────────────────────────────────
# JWT helpers
# ─────────────────────────────────────────────────────────────────────────────

def create_token() -> str:
    """Create a signed JWT for the admin session."""
    iat = _now_utc()
    exp = iat + timedelta(minutes=JWT_EXPIRE_MIN)
    payload = {
        "sub": ADMIN_EMAIL,
        "iat": int(iat.timestamp()),
        "exp": int(exp.timestamp()),
        # You could add a 'jti' here if you plan to revoke tokens
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired session: {str(e)}",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Auth dependency
# ─────────────────────────────────────────────────────────────────────────────

def require_auth(
    session: Optional[str] = Cookie(default=None),           # cookie "session"
    authorization: Optional[str] = Header(default=None),     # optional "Bearer <jwt>" fallback
) -> dict:
    """
    Validate the admin session. Accepts either:
      - Cookie: session=<jwt>
      - Header: Authorization: Bearer <jwt>
    Returns decoded claims on success; raises 401 on failure.
    """
    token = None

    # Primary: cookie
    if session:
        token = session

    # Fallback: Authorization header
    if not token and authorization:
        # Handle case-insensitively and allow extra spaces
        parts = authorization.strip().split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthenticated")

    claims = _decode_token(token)

    # OPTIONAL: verify the subject matches our configured admin
    if claims.get("sub") != ADMIN_EMAIL:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized subject")

    return claims
