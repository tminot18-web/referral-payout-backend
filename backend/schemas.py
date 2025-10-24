from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, Literal
from datetime import datetime

UserStatus = Literal["pending", "approved", "denied"]

# ---------- Users ----------
class UserCreate(BaseModel):
    user_id: str
    nick: str
    email: EmailStr
    wallet: str
    network: str   # "ERC20" | "TRC20"

class UserOut(BaseModel):
    id: int
    user_id: str
    nick: str
    email: EmailStr
    wallet: str
    network: str
    total_paid: float
    status: UserStatus

    class Config:
        from_attributes = True

class UserStatusUpdate(BaseModel):
    status: UserStatus

# ---------- Transactions ----------
class PayIn(BaseModel):
    user_id: str
    amount: float
    network: str          # "ERC20" | "TRC20"
    tx_hash: str = ""     # optional at time of call
    status: str = "success"  # "success" | "failed" | "pending"

class TxCreate(BaseModel):
    user_id: str
    amount: float
    status: str      # "success" | "failed" | "pending"
    tx_hash: str
    network: str     # "ERC20" | "TRC20"
    meta: Optional[str] = None

class TxOut(BaseModel):
    id: int
    user_id: str
    amount: float
    status: str
    tx_hash: str
    network: str
    created_at: datetime
    meta: Optional[str] = None

    class Config:
        from_attributes = True

# ---------- Auth ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str
