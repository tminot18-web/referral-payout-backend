# backend/db.py
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# -----------------------------------------------------------------------------
# Choose the DB URL:
# - If DATABASE_URL is set, use that (works for Postgres, MySQL, etc.).
# - Else, if /data exists (Render persistent disk), use sqlite:////data/app.db.
# - Else, default to a local file sqlite:///./app.db for local development.
# -----------------------------------------------------------------------------
env_url = os.getenv("DATABASE_URL")

if env_url:
    SQLALCHEMY_DATABASE_URL = env_url
elif Path("/data").exists():
    # Render disk mount
    SQLALCHEMY_DATABASE_URL = "sqlite:////data/app.db"
else:
    # Local development
    SQLALCHEMY_DATABASE_URL = "sqlite:///./app.db"

# Ensure parent directory exists for SQLite files
if SQLALCHEMY_DATABASE_URL.startswith("sqlite:///"):
    db_path = SQLALCHEMY_DATABASE_URL.replace("sqlite:///", "", 1)
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

# SQLite needs special connect args
is_sqlite = SQLALCHEMY_DATABASE_URL.startswith("sqlite")

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False} if is_sqlite else {},
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Declarative base for models to inherit from
Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a DB session and cleans it up."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

