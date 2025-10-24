from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)
import os
from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from db import Base, engine, get_db
from models import User, TxLog
from schemas import UserCreate, UserOut, TxCreate, TxOut, LoginIn
from auth import verify_admin, create_token, require_auth
from schemas import PayIn


Base.metadata.create_all(bind=engine)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", os.getenv("FRONTEND_ORIGIN","*")],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

@app.post("/login")
def login(payload: LoginIn, resp: Response):
    if not verify_admin(payload.email, payload.password):
        raise HTTPException(status_code=401, detail="Bad credentials")
    token = create_token()
    resp.set_cookie("session", token, httponly=True, samesite="lax")
    return {"ok": True}

@app.post("/logout")
def logout(resp: Response):
    resp.delete_cookie("session")
    return {"ok": True}

# Users
@app.post("/users", response_model=UserOut, dependencies=[Depends(require_auth)])
def create_user(u: UserCreate, db: Session = Depends(get_db)):
    # basic duplicate prevention
    if db.query(User).filter((User.user_id==u.user_id)|(User.email==u.email)).first():
        raise HTTPException(status_code=400, detail="User ID or email already exists")
    user = User(user_id=u.user_id, nick=u.nick, email=u.email, wallet=u.wallet, network=u.network)
    db.add(user); db.commit(); db.refresh(user)
    return user

@app.get("/users", response_model=list[UserOut], dependencies=[Depends(require_auth)])
def list_users(db: Session = Depends(get_db), q: str | None = None):
    query = db.query(User)
    if q:
        qlike = f"%{q}%"
        query = query.filter((User.user_id.like(qlike)) | (User.email.like(qlike)) | (User.wallet.like(qlike)))
    return query.order_by(User.id.desc()).all()

@app.get("/users/{user_id}", response_model=UserOut, dependencies=[Depends(require_auth)])
def get_user(user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.user_id==user_id).first()
    if not user: raise HTTPException(404, "Not found")
    return user

# Tx logs
@app.post("/tx", response_model=TxOut, dependencies=[Depends(require_auth)])
def create_tx(t: TxCreate, db: Session = Depends(get_db)):
    # update user total_paid on success
    log = TxLog(**t.dict())
    db.add(log)
    if t.status.lower() == "success":
        u = db.query(User).filter(User.user_id==t.user_id).first()
        if u: u.total_paid = (u.total_paid or 0) + float(t.amount)
    db.commit(); db.refresh(log)
    return log

@app.get("/tx/user/{user_id}", response_model=list[TxOut], dependencies=[Depends(require_auth)])
def tx_by_user(user_id: str, db: Session = Depends(get_db)):
    return db.query(TxLog).filter(TxLog.user_id==user_id).order_by(TxLog.id.desc()).all()

@app.post("/pay", dependencies=[Depends(require_auth)])
def pay(p: PayIn, db: Session = Depends(get_db)):
    # Basic validation: ensure user exists
    u = db.query(User).filter(User.user_id == p.user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    # Create a tx log (same behavior as /tx)
    log = TxLog(
        user_id=p.user_id,
        amount=p.amount,
        status=p.status,
        tx_hash=p.tx_hash,
        network=p.network,
        meta=None,
    )
    db.add(log)

    # If successful, bump user's total_paid
    if p.status.lower() == "success":
        u.total_paid = float(u.total_paid or 0) + float(p.amount)

    db.commit()
    db.refresh(log)
    return {
        "ok": True,
        "tx_id": log.id,
        "user_total_paid": u.total_paid,
    }
