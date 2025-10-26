
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
from sqlalchemy import Column, Integer, String, DateTime, or_
from sqlalchemy.sql import func
from sqlalchemy.orm import Session

# Local modules
from db import Base, engine, get_db
from models import User, TxLog
from schemas import (
    UserCreate, UserOut,
    TxCreate, TxOut,
    LoginIn, PayIn,
    UserStatusUpdate,          # <- used by PATCH /users/{user_id}/status
)
from auth import verify_admin, create_token, require_auth


# ---------------------------------------------------------------------------
# Environment & app setup
# ---------------------------------------------------------------------------

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)


# --- Define a PendingUser model here so the table always exists -------------
# (Safe even if also present in models.py; SQLAlchemy will reconcile.)
class PendingUser(Base):
    __tablename__ = "pending_users"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, unique=True, index=True)  # u_123 etc
    nick = Column(String)
    email = Column(String, index=True)
    wallet = Column(String, index=True)                # 0x... or T...
    network = Column(String)                           # ERC20 | TRC20
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Create all tables (users, txlogs, pending_users)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Referral Payout API",
    version="0.3.0",
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/openapi.json",
)

# Determine prod to set cookie flags
IS_PROD = any(
    os.getenv(k) for k in ("RENDER", "VERCEL", "RAILWAY_STATIC_URL", "FLY_IO")
) or os.getenv("ENV", "").lower() in {"prod", "production"}

# Build CORS origins
origins = {"http://localhost:5173", "http://localhost:3000"}
frontend_env = os.getenv("FRONTEND_ORIGIN")
if frontend_env and frontend_env != "*":
    origins.add(frontend_env)

public_form_origin = os.getenv("PUBLIC_FORM_ORIGIN")
if public_form_origin and public_form_origin != "*":
    origins.add(public_form_origin)

# Allow any *.netlify.app (handy for Netlify “drag-and-drop” or renamed sites)
NETLIFY_REGEX = r"^https://[a-z0-9-]+\.netlify\.app/?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(origins),
    allow_origin_regex=NETLIFY_REGEX,
    allow_credentials=True,        # cookie sessions
    allow_methods=["*"],
    allow_headers=["*"],
)


def cookie_kwargs() -> dict:
    """Cookie attributes tuned for local vs prod."""
    if IS_PROD:
        return dict(httponly=True, samesite="none", secure=True, max_age=60 * 60 * 24 * 7)
    else:
        return dict(httponly=True, samesite="lax", secure=False, max_age=60 * 60 * 24 * 7)


# ---------------------------------------------------------------------------
# Root & health
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def index():
    return RedirectResponse(url="/docs")


@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True}


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
    # must match attributes used when setting the cookie
    kw = cookie_kwargs()
    resp.delete_cookie(key="session", httponly=True, samesite=kw["samesite"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

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


# NEW: Update a user's status (approved / pending / denied)
@app.patch("/users/{user_id}/status", response_model=UserOut, dependencies=[Depends(require_auth)])
def update_user_status(user_id: str, body: UserStatusUpdate, db: Session = Depends(get_db)):
    """
    Update a user's status. Valid values come from UserStatusUpdate enum:
    'pending' | 'approved' | 'denied'
    """
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Not found")

    user.status = body.status  # schemas.UserStatusUpdate enforces enum values
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Pending requests (Public form + Admin moderation)
# ---------------------------------------------------------------------------

@app.post("/users/public", status_code=201)
def public_submit(u: UserCreate, db: Session = Depends(get_db)):
    """
    Public form submission. Stores into pending_users.
    If a pending record for the same user_id exists, replace it.
    """
    # If user already approved, do not allow duplicate
    exists = db.query(User).filter(or_(User.user_id == u.user_id, User.email == u.email)).first()
    if exists:
        # Treat as conflict – Admin has this user already
        raise HTTPException(status_code=409, detail="User already exists")

    pending = db.query(PendingUser).filter(PendingUser.user_id == u.user_id).first()
    if pending:
        pending.nick = u.nick
        pending.email = u.email
        pending.wallet = u.wallet
        pending.network = u.network
    else:
        pending = PendingUser(
            user_id=u.user_id,
            nick=u.nick,
            email=u.email,
            wallet=u.wallet,
            network=u.network,
        )
        db.add(pending)

    db.commit()
    return {"ok": True}


@app.get("/users/pending", dependencies=[Depends(require_auth)])
def list_pending(db: Session = Depends(get_db)):
    rows = db.query(PendingUser).order_by(PendingUser.id.desc()).all()
    return [
        dict(
            id=r.id,
            user_id=r.user_id,
            nick=r.nick,
            email=r.email,
            wallet=r.wallet,
            network=r.network,
            created_at=str(r.created_at) if r.created_at else None,
        ) for r in rows
    ]


@app.post("/users/pending/{user_id}/approve", dependencies=[Depends(require_auth)])
def approve_pending(user_id: str, db: Session = Depends(get_db)):
    p = db.query(PendingUser).filter(PendingUser.user_id == user_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    # Prevent duplicates if admin approved earlier
    exists = db.query(User).filter(or_(User.user_id == p.user_id, User.email == p.email)).first()
    if exists:
        db.delete(p)
        db.commit()
        return {"ok": True, "already_present": True}

    user = User(
        user_id=p.user_id,
        nick=p.nick,
        email=p.email,
        wallet=p.wallet,
        network=p.network,
    )
    db.add(user)
    db.delete(p)
    db.commit()
    db.refresh(user)
    return {
        "ok": True,
        "user": dict(
            id=user.id,
            user_id=user.user_id,
            nick=user.nick,
            email=user.email,
            wallet=user.wallet,
            network=user.network,
            total_paid=float(user.total_paid or 0.0),
        ),
    }


@app.post("/users/pending/{user_id}/deny", dependencies=[Depends(require_auth)])
def deny_pending(user_id: str, db: Session = Depends(get_db)):
    p = db.query(PendingUser).filter(PendingUser.user_id == user_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(p)
    db.commit()
    return {"ok": True}


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
# Pay (one-click payout log; off-chain recording)
# ---------------------------------------------------------------------------

@app.post("/pay", dependencies=[Depends(require_auth)])
def pay(p: PayIn, db: Session = Depends(get_db)):
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
