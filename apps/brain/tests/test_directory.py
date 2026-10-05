import sqlite3

from fambrain_kernel.auth.directory import lookup_user
from fambrain_kernel.db.models import UserStatus


def test_lookup_cuid_from_prisma_sqlite(tmp_path, monkeypatch):
    database = tmp_path / "dev.db"
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE User (
              id TEXT, username TEXT, displayName TEXT, passwordHash TEXT,
              role TEXT, status TEXT, corpusUserId TEXT
            )
            """
        )
        connection.execute(
            "INSERT INTO User VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("cmp_existing", "ada", "Ada", "$2b$12$hash", "ADMIN", "ACTIVE", "cmp_existing"),
        )
    monkeypatch.setenv("DATABASE_URL", f"file:{database}")
    found = lookup_user("cmp_existing")
    assert found is not None
    assert found.id == "cmp_existing"
    assert found.status == UserStatus.ACTIVE
    assert found.corpus_user_id == "cmp_existing"
