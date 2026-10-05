from __future__ import annotations

from pathlib import Path

from fambrain_kernel.config import find_repo_root

DOC_USERS_DIR = "users"
CORPUS_DIR = "corpus"
VAULT_DIR = "vault"
VAULT_UPLOADS_DIR = "originals/uploads"
CORPUS_IMPORTS_DIR = "imports"
LEARNED_DIR = "learned"
SCAN_FOLDERS = ("experience", "projects", "personal")
CORPUS_SCAN_FOLDERS = (*SCAN_FOLDERS, LEARNED_DIR)


def doc_root() -> Path:
    return find_repo_root() / "data" / "doc"


def user_home(user_id: str) -> Path:
    return doc_root() / DOC_USERS_DIR / user_id


def user_corpus_root(corpus_user_id: str) -> Path:
    return user_home(corpus_user_id) / CORPUS_DIR


def user_vault_root(user_id: str) -> Path:
    return user_home(user_id) / VAULT_DIR


def vault_uploads_root(user_id: str) -> Path:
    return user_vault_root(user_id) / VAULT_UPLOADS_DIR


def corpus_import_dir(corpus_user_id: str, category: str) -> Path:
    return user_corpus_root(corpus_user_id) / category / CORPUS_IMPORTS_DIR


def is_noise_path(repo_path: str) -> bool:
    lowered = repo_path.replace("\\", "/").lower()
    return lowered.endswith("/readme.md") or "/_template.md" in lowered


def repo_path(path: Path) -> str:
    return path.relative_to(doc_root()).as_posix()
