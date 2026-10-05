"""Existing FamBrain accounts live in the Prisma SQLite file. Ids are cuid strings."""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from fambrain_kernel.config import find_repo_root
from fambrain_kernel.db.models import UserRole, UserStatus


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
    candidates: list[Path] = []
    if raw.startswith("file:"):
        location = raw[5:]
        path = Path(location)
        if not path.is_absolute():
            candidates.append(find_repo_root() / location)
            candidates.append(find_repo_root() / "packages" / "db" / location)
        else:
            candidates.append(path)
    candidates.append(find_repo_root() / "packages" / "db" / "prisma" / "dev.db")
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


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


def _query(sql: str, params: tuple) -> DirectoryUser | None:
    path = prisma_sqlite_path()
    if path is None:
        return None
    try:
        with sqlite3.connect(path) as connection:
            connection.row_factory = sqlite3.Row
            row = connection.execute(sql, params).fetchone()
    except sqlite3.Error:
        return None
    if row is None:
        return None
    return _row_to_user(row)


def lookup_user(user_id: str) -> DirectoryUser | None:
    return _query(
        """
        SELECT id, username, displayName, passwordHash, role, status, corpusUserId
        FROM User WHERE id = ?
        """,
        (user_id,),
    )


def lookup_username(username: str) -> DirectoryUser | None:
    return _query(
        """
        SELECT id, username, displayName, passwordHash, role, status, corpusUserId
        FROM User WHERE username = ?
        """,
        (username,),
    )
