# main.py
from __future__ import annotations

from pathlib import Path
import os
import uuid
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from db import Base, engine, get_db
from models import User, TxLog
from schemas import (
    UserCreate, UserOut,
    TxCreate, TxOut,
    LoginIn, PayIn
)
from auth import verify_admin, create_token, require_auth

# ---------------------------------------------------------------------------
# Environment & app setup
# ---------------------------------------------------------------------------

# Load .env that sits next to this file
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Referral Payout API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/openapi.json",
)

# Detect prod hosting (Render/Vercel/etc.) to decide cookie flags
IS_PROD = any(
    os.getenv(k) for k in ("RENDER", "VERCEL", "RAILWAY_STATIC_URL", "FLY_IO")
) or os.getenv("ENV", "").lower() in {"prod", "production"}

# Build explicit CORS origin list (we use credentials)
origins = {"http://localhost:5173", "http://localhost:3000"}
frontend_env = os.getenv("FRONTEND_ORIGIN")
if frontend_env and frontend_env != "*":
    origins.add(frontend_env)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(origins),
    allow_credentials=True,          # required for cookie auth
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper: cookie parameters based on environment
def cookie_kwargs() -> dict:
    """
    Return kwargs for Response.set_cookie that are correct for the environment.
    - Local dev: SameSite=Lax, Secure=False
    - Prod (HTTPS): SameSite=None, Secure=True
    """
    if IS_PROD:
        return dict(httponly=True, samesite="none", secure=True, max_age=60 * 60 * 24 * 7)
    else:
        return dict(httponly=True, samesite="lax", secure=False, max_age=60 * 60 * 24 * 7)

# ---------------------------------------------------------------------------
# Root & health
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def index():
    """Redirect base URL to Swagger docs so the live URL is friendly."""
    return RedirectResponse(url="/docs")

@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True}

# Optional: quick probe for the UI to learn auth status
@app.get("/session")
def session_probe(dep: None = Depends(require_auth)):
    return {"authenticated": True}

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.post("/login", status_code=status.HTTP_200_OK)
def login(payload: LoginIn, resp: Response):
    if not verify_admin(payload.email, payload.password):
        raise HTTPException(status_code=401, detail="Bad credentials")
    token = create_token()
    resp.set_cookie(key="session", value=token, **cookie_kwargs())
    return {"ok": True}

@app.post("/logout", status_code=status.HTTP_200_OK)
def logout(resp: Response):
    # Name and (for safety) same attributes as set_cookie, so the browser deletes the right one
    kwargs = cookie_kwargs()
    resp.delete_cookie(key="session", httponly=True, samesite=kwargs["samesite"])
    return {"ok": True}

# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

@app.post("/users", response_model=UserOut, dependencies=[Depends(require_auth)])
def create_user(u: UserCreate, db: Session = Depends(get_db)):
    # Prevent duplicates on user_id or email
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

# ---------------------------------------------------------------------------
# Tx logs
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Pay (one-click payout log)
# ---------------------------------------------------------------------------

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
