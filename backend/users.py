# users.py
from __future__ import annotations

from typing import Literal, Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from pydantic import BaseModel, EmailStr, Field, constr
from sqlalchemy.orm import Session
from sqlalchemy import select

# 🔧 Adjust these imports to your project structure
# e.g., from app.db import get_db
#       from app.auth import require_admin, get_current_user
#       from app.models import User
from .db import get_db                  # <-- change if needed
from .auth import require_admin         # <-- change if needed
from .models import User                # <-- change if needed

router = APIRouter(prefix="/users", tags=["users"])

# ---------- Schemas ----------

NetworkLiteral = Literal["ERC20", "SOLANA", "TRON", "BSC", "OTHER"]
StatusLiteral = Literal["pending", "approved", "denied"]

class UserOut(BaseModel):
    id: int
    user_id: str
    nick: Optional[str] = None
    email: Optional[EmailStr] = None
    wallet: Optional[str] = None
    network: Optional[NetworkLiteral] = None
    total_paid: float = 0.0
    status: StatusLiteral

    class Config:
        from_attributes = True  # SQLAlchemy -> Pydantic

class UserCreate(BaseModel):
    user_id: constr(strip_whitespace=True, min_length=1) = Field(..., description="External user id or handle")
    nick: Optional[constr(strip_whitespace=True, min_length=1)] = None
    email: Optional[EmailStr] = None
    wallet: Optional[constr(strip_whitespace=True, min_length=1)] = None
    network: Optional[NetworkLiteral] = None
    status: StatusLiteral = "approved"  # admin creates typically approved

class PublicUserCreate(BaseModel):
    user_id: constr(strip_whitespace=True, min_length=1)
    nick: Optional[constr(strip_whitespace=True, min_length=1)] = None
    email: Optional[EmailStr] = None
    wallet: Optional[constr(strip_whitespace=True, min_length=1)] = None
    network: Optional[NetworkLiteral] = None
    # Always stored as pending; no status field exposed here.

class StatusPatch(BaseModel):
    status: StatusLiteral

# ---------- Helpers ----------

_ALLOWED_STATUSES = {"pending", "approved", "denied"}

def _to_out(u: User) -> UserOut:
    return UserOut.model_validate(u)

def _ensure_status(val: str) -> str:
    v = (val or "").lower().strip()
    if v not in _ALLOWED_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status '{val}'. Allowed: pending, approved, denied.",
        )
    return v

# ---------- Routes ----------

@router.get("", response_model=List[UserOut])
def list_users(
    status_filter: Optional[str] = Query(
        None, description="Filter by status: pending|approved|denied"
    ),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """
    Lists users. If status_filter provided, applies it server-side.
    Always returns 200 with [] when no rows match.
    """
    stmt = select(User)
    if status_filter:
        sf = _ensure_status(status_filter)
        stmt = stmt.where(User.status == sf)
    rows = db.execute(stmt).scalars().all()
    return [_to_out(u) for u in rows]


@router.get("/pending", response_model=List[UserOut])
def list_pending(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """
    Admin-only convenience route for pending users.
    Returns [] (200) when none exist.
    """
    rows = db.execute(select(User).where(User.status == "pending")).scalars().all()
    return [_to_out(u) for u in rows]


@router.post("/pending/{user_id}/approve", response_model=UserOut)
def approve_pending(
    user_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """
    Admin: set status to 'approved' for a pending user.
    Returns 404 if user not found.
    """
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="User not found")
    u.status = "approved"
    db.add(u)
    db.commit()
    db.refresh(u)
    return _to_out(u)


@router.post("/pending/{user_id}/deny", response_model=UserOut)
def deny_pending(
    user_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """
    Admin: set status to 'denied' for a pending user.
    Returns 404 if user not found.
    """
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="User not found")
    u.status = "denied"
    db.add(u)
    db.commit()
    db.refresh(u)
    return _to_out(u)


@router.patch("/{user_id}/status", response_model=UserOut)
def update_status(
    user_id: int,
    payload: StatusPatch,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """
    Admin: update user status to pending|approved|denied via PATCH.
    """
    new_status = _ensure_status(payload.status)
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="User not found")
    u.status = new_status
    db.add(u)
    db.commit()
    db.refresh(u)
    return _to_out(u)


@router.post("/public", response_model=UserOut, status_code=http_status.HTTP_201_CREATED)
def public_self_add(
    payload: PublicUserCreate,
    db: Session = Depends(get_db),
):
    """
    Public form submission: creates a *pending* user.
    Idempotency-by-email/user_id is a good idea—adjust if you enforce uniqueness.
    """
    u = User(
        user_id=payload.user_id,
        nick=payload.nick,
        email=payload.email,
        wallet=payload.wallet,
        network=payload.network,
        total_paid=0.0,
        status="pending",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return _to_out(u)


@router.post("", response_model=UserOut, status_code=http_status.HTTP_201_CREATED)
def admin_create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """
    Admin create. Defaults to approved unless specified otherwise.
    """
    status_norm = _ensure_status(payload.status)
    u = User(
        user_id=payload.user_id,
        nick=payload.nick,
        email=payload.email,
        wallet=payload.wallet,
        network=payload.network,
        total_paid=0.0,
        status=status_norm,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return _to_out(u)


@router.delete("/{user_id}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """
    Admin delete. 204 on success; 404 if not found.
    """
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="User not found")
    db.delete(u)
    db.commit()
    return None

