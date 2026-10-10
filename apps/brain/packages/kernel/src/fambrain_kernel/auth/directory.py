"""Read website accounts from the Prisma SQLite file."""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from fambrain_kernel.auth.roles import UserRole, UserStatus
from fambrain_kernel.config import find_repo_root

_SCHEMA = """
CREATE TABLE IF NOT EXISTS User (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  displayName TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  corpusUserId TEXT
);
"""


@dataclass(frozen=True)
class DirectoryUser:
    id: str
    username: str
    display_name: str
    password_hash: str
    role: UserRole
    status: UserStatus
    corpus_user_id: str | None


def prisma_sqlite_path() -> Path | None:
    raw = os.environ.get("DATABASE_URL", "").strip().strip('"').strip("'")
    if raw.startswith("file:"):
        location = raw[5:]
        path = Path(location)
        if not path.is_absolute():
            path = find_repo_root() / location
        return path
    fallback = find_repo_root() / "packages" / "db" / "prisma" / "dev.db"
    return fallback if fallback.is_file() else None


def _connect(*, create: bool = False) -> sqlite3.Connection | None:
    path = prisma_sqlite_path()
    if path is None:
        return None
    if not path.is_file() and not create:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    if create:
        connection.executescript(_SCHEMA)
    return connection


def ensure_account_db() -> bool:
    connection = _connect(create=True)
    if connection is None:
        return False
    connection.close()
    return True


def account_ping() -> bool:
    connection = _connect()
    if connection is None:
        return False
    try:
        connection.execute("SELECT 1")
    except sqlite3.Error:
        return False
    finally:
        connection.close()
    return True


def _row_to_user(row: sqlite3.Row) -> DirectoryUser | None:
    try:
        role = UserRole(row["role"])
        status = UserStatus(row["status"])
    except ValueError:
        return None
    corpus = row["corpusUserId"]
    return DirectoryUser(
        id=row["id"],
        username=row["username"],
        display_name=row["displayName"],
        password_hash=row["passwordHash"],
        role=role,
        status=status,
        corpus_user_id=corpus if isinstance(corpus, str) and corpus else None,
    )


def lookup_user(user_id: str) -> DirectoryUser | None:
    connection = _connect()
    if connection is None:
        return None
    try:
        row = connection.execute(
            """
            SELECT id, username, displayName, passwordHash, role, status, corpusUserId
            FROM User WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
    except sqlite3.Error:
        return None
    finally:
        connection.close()
    if row is None:
        return None
    return _row_to_user(row)
