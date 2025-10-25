
# backend/db.py
import os
from typing import Generator, Optional

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# -----------------------------------------------------------------------------
# Build & normalize DATABASE_URL
#   - Accepts postgres:// or postgresql://; converts to postgresql+psycopg://
#   - Appends ?sslmode=require for non-local connections if not present
# -----------------------------------------------------------------------------

def _normalize_db_url(raw: Optional[str]) -> str:
    db_url = (raw or "").strip()

    if not db_url:
        # Fallback for local dev (SQLite) if DATABASE_URL is not set.
        # You can remove this block if you always require Postgres.
        sqlite_url = "sqlite:///./app.db"
        return sqlite_url

    # Normalize scheme: postgres://  -> postgresql://
    db_url = db_url.replace("postgres://", "postgresql://", 1)

    # Ensure psycopg (v3) driver is used unless user already specified a driver
    if db_url.startswith("postgresql://") and "+psycopg" not in db_url and "+psycopg2" not in db_url:
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

    # Hosted providers (Render/Neon/RDS/etc.) require SSL. Add if missing.
    if "localhost" not in db_url and "127.0.0.1" not in db_url and "sslmode=" not in db_url:
        db_url += ("&" if "?" in db_url else "?") + "sslmode=require"

    return db_url


DATABASE_URL = _normalize_db_url(os.getenv("DATABASE_URL"))

# -----------------------------------------------------------------------------
# SQLAlchemy setup
# -----------------------------------------------------------------------------

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # drop dead connections before issuing queries
    future=True,          # 2.0-style engine
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    future=True,
)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a DB session and ensures close."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Optional: create tables if they don't exist yet."""
    from models import User, TxLog  # ensure models are imported
    Base.metadata.create_all(bind=engine)
