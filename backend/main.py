
# main.py
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

# Local app imports
from db import Base, engine, get_db
from models import User, TxLog
from schemas import (
    UserCreate, UserOut,
    TxCreate, TxOut,
    LoginIn, PayIn,
)
from auth import verify_admin, create_token, require_auth


# -----------------------------------------------------------------------------
# Environment + App
# -----------------------------------------------------------------------------
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Referral Payout API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/openapi.json",
)

# Are we on a public host? (Render, Vercel, etc.)
IS_PROD = any(
    os.getenv(k) for k in ("RENDER", "VERCEL", "RAILWAY_STATIC_URL", "FLY_IO")
) or os.getenv("ENV", "").lower() in {"prod", "production"}


# -----------------------------------------------------------------------------
# CORS: normalize env origins + allow *.netlify.app
# -----------------------------------------------------------------------------
def _clean_origin(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    return url.strip().rstrip("/")

allowed_origins = set()

# Admin UI (Netlify) origin
frontend_origin = _clean_origin(os.getenv("FRONTEND_ORIGIN"))
if frontend_origin and frontend_origin != "*":
    allowed_origins.add(frontend_origin)

# Public form (Netlify) origin
public_form_origin = _clean_origin(os.getenv("PUBLIC_FORM_ORIGIN"))
if public_form_origin and public_form_origin != "*":
    allowed_origins.add(public_form_origin)

# Optional: comma-separated extra origins (e.g., branch/preview URLs, custom domains)
extra = os.getenv("EXTRA_ALLOWED_ORIGINS", "")
if extra:
    for part in extra.split(","):
        val = _clean_origin(part)
        if val:
            allowed_origins.add(val)

# Allow any *.netlify.app (public/preview form deployments)
NETLIFY_REGEX = r"^https://[A-Za-z0-9-]+\.netlify\.app/?$"

print("=== CORS config ===")
print("allow_origins:", allowed_origins if allowed_origins else "(none)")
print("allow_origin_regex:", NETLIFY_REGEX)
print("===================")

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(allowed_origins),   # exact matches (env)
    allow_origin_regex=NETLIFY_REGEX,      # wildcard for *.netlify.app
    allow_credentials=True,                # needed for admin cookie auth
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# Cookies
# -----------------------------------------------------------------------------
def cookie_kwargs() -> dict:
    """
    Return secure cookie settings depending on environment.
    - Local dev: SameSite=Lax, Secure=False
    - Prod (HTTPS hosts): SameSite=None, Secure=True
    """
    if IS_PROD:
        return dict(httponly=True, samesite="none", secure=True, max_age=60 * 60 * 24 * 7)
    else:
        return dict(httponly=True, samesite="lax", secure=False, max_age=60 * 60 * 24 * 7)


# -----------------------------------------------------------------------------
# Root & Health
# -----------------------------------------------------------------------------
@app.get("/", include_in_schema=False)
def index():
    return RedirectResponse(url="/docs")


@app.get("/healthz", include_in_schema=False)
def healthz():
    # Light DB touch to ensure DB is reachable (optional)
    try:
        with next(get_db()) as db:
            db.execute("SELECT 1")
    except Exception:
        # If DB probe fails, still return something to indicate liveness.
        return {"ok": True, "db": "unavailable"}
    return {"ok": True, "db": "ok"}


# Quick probe for the UI to learn auth state
@app.get("/session")
def session_probe(_=Depends(require_auth)):
    return {"authenticated": True}


# -----------------------------------------------------------------------------
# Auth
# -----------------------------------------------------------------------------
@app.post("/login", status_code=status.HTTP_200_OK)
def login(payload: LoginIn, resp: Response):
    if not verify_admin(payload.email, payload.password):
        raise HTTPException(status_code=401, detail="Bad credentials")
    token = create_token()
    resp.set_cookie(key="session", value=token, **cookie_kwargs())
    return {"ok": True}


@app.post("/logout", status_code=status.HTTP_200_OK)
def logout(resp: Response):
    # Delete cookie with same attributes it was set with
    kw = cookie_kwargs()
    resp.delete_cookie(key="session", httponly=True, samesite=kw["samesite"])
    return {"ok": True}


# -----------------------------------------------------------------------------
# Users (ADMIN)
# -----------------------------------------------------------------------------
@app.post("/users", response_model=UserOut, dependencies=[Depends(require_auth)])
def create_user(u: UserCreate, db: Session = Depends(get_db)):
    # prevent duplicates on user_id or email
    exists = db.query(User).filter(
        or_(User.user_id == u.user_id, User.email == u.email)
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="User ID or email already exists")

    user = User(
        user_id=u.user_id,
        nick=u.nick,
        email=u.email,
        wallet=u.wallet,
        network=u.network,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.get("/users", response_model=List[UserOut], dependencies=[Depends(require_auth)])
def list_users(db: Session = Depends(get_db), q: Optional[str] = None):
    query = db.query(User)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(
            User.user_id.ilike(like),
            User.nick.ilike(like),
            User.email.ilike(like),
            User.wallet.ilike(like),
        ))
    return query.order_by(User.id.desc()).all()


@app.get("/users/{user_id}", response_model=UserOut, dependencies=[Depends(require_auth)])
def get_user(user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Not found")
    return user


@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_auth)])
def delete_user(user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(user)
    db.commit()
    return


# -----------------------------------------------------------------------------
# Public self-add endpoint (NO auth)
# -----------------------------------------------------------------------------
@app.post("/users/public", status_code=status.HTTP_201_CREATED)
def public_self_add(u: UserCreate, db: Session = Depends(get_db)):
    """
    For the Netlify-hosted public form. Adds a user record pending admin review.
    The admin UI can delete or keep this entry.
    """
    # Basic validations
    if not u.user_id or not u.email or not u.wallet or not u.network:
        raise HTTPException(status_code=400, detail="Missing required fields")

    # Avoid exact duplicates on user_id/email
    exists = db.query(User).filter(
        or_(User.user_id == u.user_id, User.email == u.email)
    ).first()
    if exists:
        # Return 200 to make the form UX nice (idempotency feel)
        return {"ok": True, "message": "Already on file"}

    user = User(
        user_id=u.user_id.strip(),
        nick=(u.nick or "").strip(),
        email=u.email.strip(),
        wallet=u.wallet.strip(),
        network=u.network.strip(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"ok": True, "id": user.id}


# -----------------------------------------------------------------------------
# Tx logs (ADMIN)
# -----------------------------------------------------------------------------
@app.post("/tx", response_model=TxOut, dependencies=[Depends(require_auth)])
def create_tx(t: TxCreate, db: Session = Depends(get_db)):
    log = TxLog(**t.dict())
    db.add(log)

    # bump total_paid on success
    if (t.status or "").lower() == "success":
        u = db.query(User).filter(User.user_id == t.user_id).first()
        if u:
            u.total_paid = float(u.total_paid or 0) + float(t.amount)

    db.commit()
    db.refresh(log)
    return log


@app.get("/tx/user/{user_id}", response_model=List[TxOut], dependencies=[Depends(require_auth)])
def tx_by_user(user_id: str, db: Session = Depends(get_db)):
    return db.query(TxLog).filter(TxLog.user_id == user_id).order_by(TxLog.id.desc()).all()


# -----------------------------------------------------------------------------
# Pay (ADMIN) – one-click payout log
# -----------------------------------------------------------------------------
@app.post("/pay", dependencies=[Depends(require_auth)])
def pay(p: PayIn, db: Session = Depends(get_db)):
    # ensure user exists
    u = db.query(User).filter(User.user_id == p.user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    if p.amount is None or p.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    tx_hash = p.tx_hash or ("0x" + uuid.uuid4().hex + uuid.uuid4().hex[:8])
    status_str = (p.status or "success").lower()

    log = TxLog(
        user_id=p.user_id,
        amount=p.amount,
        status=status_str,
        tx_hash=tx_hash,
        network=p.network,
        meta=None,
    )
    db.add(log)

    if status_str == "success":
        u.total_paid = float(u.total_paid or 0) + float(p.amount)

    db.commit()
    db.refresh(log)
    return {"ok": True, "tx_id": log.id, "user_total_paid": u.total_paid}
