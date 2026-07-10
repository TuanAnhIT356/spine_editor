"""SQLAlchemy engine/session. SQLite in dev; DATABASE_URL can point at Postgres later."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import config


class Base(DeclarativeBase):
    pass


def _normalize_url(url: str) -> str:
    """Accept the postgres:// / postgresql:// URLs hosts hand out and route them
    through the psycopg3 driver."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


database_url = _normalize_url(config.database_url)
connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
# pre_ping: serverless Postgres (Neon/Supabase) drops idle connections.
engine = create_engine(database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
        session.commit()
