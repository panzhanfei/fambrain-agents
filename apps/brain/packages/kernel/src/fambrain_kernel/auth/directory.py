"""Accounts and conversations live in the Prisma SQLite file."""

from __future__ import annotations

import os
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from fambrain_kernel.auth.roles import UserRole, UserStatus
from fambrain_kernel.config import find_repo_root

_SCHEMA = """
CREATE TABLE IF NOT EXISTS User (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  nationalId TEXT NOT NULL UNIQUE,
  displayName TEXT NOT NULL,
  relationToPrincipal TEXT NOT NULL,
  corpusUserId TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS Conversation (
  id TEXT PRIMARY KEY,
  userId TEXT,
  title TEXT NOT NULL DEFAULT '新对话',
  pinned INTEGER NOT NULL DEFAULT 0,
  sessionSummary TEXT,
  sessionSummaryAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
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


def _stamp() -> str:
    return datetime.now(UTC).isoformat()


def _connect(*, create: bool = False) -> sqlite3.Connection | None:
    path = prisma_sqlite_path()
    if path is None:
        return None
    if not path.is_file() and not create:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    if create:
        connection.executescript(_SCHEMA)
    return connection


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
    connection = _connect()
    if connection is None:
        return None
    try:
        row = connection.execute(sql, params).fetchone()
    except sqlite3.Error:
        return None
    finally:
        connection.close()
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


def lookup_national_id(national_id: str) -> DirectoryUser | None:
    return _query(
        """
        SELECT id, username, displayName, passwordHash, role, status, corpusUserId
        FROM User WHERE nationalId = ?
        """,
        (national_id,),
    )


def lookup_username(username: str) -> DirectoryUser | None:
    return _query(
        """
        SELECT id, username, displayName, passwordHash, role, status, corpusUserId
        FROM User WHERE username = ?
        """,
        (username,),
    )


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


def insert_user(
    *,
    username: str,
    password_hash: str,
    national_id: str,
    display_name: str,
    relation_to_principal: str,
    role: UserRole,
    status: UserStatus,
    corpus_user_id: str | None,
) -> DirectoryUser:
    user_id = str(uuid.uuid4())
    now = _stamp()
    connection = _connect(create=True)
    if connection is None:
        raise sqlite3.OperationalError("账号库不可用")
    try:
        connection.execute(
            """
            INSERT INTO User (
              id, username, passwordHash, nationalId, displayName, relationToPrincipal,
              corpusUserId, role, status, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                username,
                password_hash,
                national_id,
                display_name,
                relation_to_principal,
                corpus_user_id,
                role.value,
                status.value,
                now,
                now,
            ),
        )
        connection.commit()
    finally:
        connection.close()
    created = lookup_user(user_id)
    if created is None:
        raise sqlite3.OperationalError("账号写入后读不回来")
    return created


def count_users() -> int:
    connection = _connect(create=True)
    if connection is None:
        return 0
    try:
        row = connection.execute("SELECT COUNT(*) AS n FROM User").fetchone()
    finally:
        connection.close()
    if row is None:
        return 0
    return int(row["n"])


def first_active_admin_id() -> str | None:
    connection = _connect()
    if connection is None:
        return None
    try:
        row = connection.execute(
            """
            SELECT id FROM User
            WHERE role = ? AND status = ?
            ORDER BY createdAt ASC
            LIMIT 1
            """,
            (UserRole.ADMIN.value, UserStatus.ACTIVE.value),
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        return None
    return str(row["id"])


def list_conversations(user_id: str) -> list[sqlite3.Row]:
    connection = _connect()
    if connection is None:
        return []
    try:
        rows = connection.execute(
            """
            SELECT id, title, pinned, createdAt, updatedAt
            FROM Conversation
            WHERE userId = ?
            ORDER BY pinned DESC, updatedAt DESC
            """,
            (user_id,),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        connection.close()
    return list(rows)


def get_conversation(conversation_id: str) -> sqlite3.Row | None:
    connection = _connect()
    if connection is None:
        return None
    try:
        row = connection.execute(
            """
            SELECT id, userId, title, pinned, createdAt, updatedAt
            FROM Conversation WHERE id = ?
            """,
            (conversation_id,),
        ).fetchone()
    except sqlite3.Error:
        return None
    finally:
        connection.close()
    return row


def insert_conversation(user_id: str, title: str) -> sqlite3.Row:
    conversation_id = str(uuid.uuid4())
    now = _stamp()
    connection = _connect(create=True)
    if connection is None:
        raise sqlite3.OperationalError("账号库不可用")
    try:
        connection.execute(
            """
            INSERT INTO Conversation (id, userId, title, pinned, createdAt, updatedAt)
            VALUES (?, ?, ?, 0, ?, ?)
            """,
            (conversation_id, user_id, title, now, now),
        )
        connection.commit()
        row = connection.execute(
            """
            SELECT id, userId, title, pinned, createdAt, updatedAt
            FROM Conversation WHERE id = ?
            """,
            (conversation_id,),
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        raise sqlite3.OperationalError("会话写入后读不回来")
    return row
