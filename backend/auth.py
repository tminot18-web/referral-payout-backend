# backend/auth.py
import os
import bcrypt
from datetime import datetime, timedelta
from jose import jwt
from fastapi import HTTPException, Cookie

# ENV (set these in .env)
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret")
JWT_EXPIRE_MIN = int(os.getenv("JWT_EXPIRE_MIN", "43200"))  # 30 days default
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD_HASH = os.getenv("ADMIN_PASSWORD_HASH", "")  # bcrypt hash

def verify_admin(email: str, password: str) -> bool:
    """Return True if email/password match the single admin in env."""
    if email != ADMIN_EMAIL:
        return False
    if not ADMIN_PASSWORD_HASH:
        # Fail closed if not configured
        return False
    try:
        return bcrypt.checkpw(password.encode(), ADMIN_PASSWORD_HASH.encode())
    except Exception:
        return False

def create_token() -> str:
    """Create a short JWT for cookie-based session."""
    exp = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MIN)
    return jwt.encode({"exp": exp, "sub": "admin"}, JWT_SECRET, algorithm="HS256")

def require_auth(session: str | None = Cookie(default=None)) -> bool:
    """FastAPI dependency to guard routes; validates the session cookie."""
    if not session:
        raise HTTPException(status_code=401, detail="Unauthenticated")
    try:
        jwt.decode(session, JWT_SECRET, algorithms=["HS256"])
        return True
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
