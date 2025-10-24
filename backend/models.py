
from sqlalchemy import Column, Integer, String, Float, DateTime, Text
from sqlalchemy.sql import func
from db import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)     # internal autoinc id
    user_id = Column(String, unique=True, index=True)      # external id (e.g., u_001)
    nick = Column(String)
    email = Column(String, index=True)
    wallet = Column(String, index=True)                    # 0x... or T...
    network = Column(String)                               # ERC20 | TRC20
    total_paid = Column(Float, default=0.0)
    status = Column(String, index=True, default="approved", server_default="approved")  # pending|approved|denied

class TxLog(Base):
    __tablename__ = "txlogs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)                   # links to User.user_id
    amount = Column(Float)
    status = Column(String)                                # success | failed | pending
    tx_hash = Column(String)
    network = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    meta = Column(Text)                                    # optional JSON string
