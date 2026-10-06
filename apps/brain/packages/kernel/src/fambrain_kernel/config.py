"""Process settings loaded from the environment and the repo-root .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def find_repo_root() -> Path:
    """Walk upward from this file and the working directory until the repo root."""
    starts = [Path(__file__).resolve(), Path.cwd().resolve()]
    seen: set[Path] = set()
    for start in starts:
        for candidate in (start, *start.parents):
            if candidate in seen:
                continue
            seen.add(candidate)
            if (candidate / "AGENTS.md").is_file() and (candidate / "apps").is_dir():
                return candidate
    return Path.cwd()


def _env_file() -> Path | None:
    path = find_repo_root() / ".env"
    return path if path.is_file() else None


class Settings(BaseSettings):
    """Process settings. Postgres URL is `FAMBRAIN_DATABASE_URL`, not Prisma's `DATABASE_URL`."""

    model_config = SettingsConfigDict(
        env_file=_env_file(),
        extra="ignore",
        populate_by_name=True,
    )

    environment: Annotated[str, Field(validation_alias="FAMBRAIN_ENV")] = "development"
    database_url: Annotated[str, Field(validation_alias="FAMBRAIN_DATABASE_URL")] = (
        "postgresql+psycopg://fambrain:fambrain@127.0.0.1:5432/fambrain"
    )
    db_create_all: Annotated[bool, Field(validation_alias="FAMBRAIN_DB_CREATE_ALL")] = False
    jwt_secret: Annotated[str, Field(validation_alias="JWT_SECRET")] = ""
    auth_cookie_name: str = "fambrain_token"
    auth_cookie_secure: Annotated[str, Field(validation_alias="AUTH_COOKIE_SECURE")] = ""
    token_max_age_sec: int = 60 * 60 * 24 * 14
    auth_failure_jitter_min_ms: int = 180
    auth_failure_jitter_max_ms: int = 520
    brain_py_host: Annotated[str, Field(validation_alias="FAMBRAIN_HOST")] = "127.0.0.1"
    brain_py_port: Annotated[
        int,
        Field(validation_alias=AliasChoices("BRAIN_SERVICE_PORT", "BRAIN_PY_PORT")),
    ] = 3011
    chat_provider: Annotated[str, Field(validation_alias="CHAT_PROVIDER")] = "ollama"
    openai_base_url: Annotated[str, Field(validation_alias="OPENAI_BASE_URL")] = (
        "https://api.deepseek.com"
    )
    openai_api_key: Annotated[str, Field(validation_alias="OPENAI_API_KEY")] = ""
    deepseek_api_key: Annotated[str, Field(validation_alias="DEEPSEEK_API_KEY")] = ""
    openai_model: Annotated[str, Field(validation_alias="OPENAI_MODEL")] = "deepseek-v4-flash"
    ollama_base_url: Annotated[str, Field(validation_alias="OLLAMA_BASE_URL")] = ""
    ollama_host: Annotated[str, Field(validation_alias="OLLAMA_HOST")] = "127.0.0.1"
    ollama_port: Annotated[int, Field(validation_alias="OLLAMA_PORT")] = 11434
    ollama_model: Annotated[str, Field(validation_alias="OLLAMA_MODEL")] = "qwen2.5:14b"
    ollama_embed_model: Annotated[str, Field(validation_alias="OLLAMA_MODEL_EMBED")] = (
        "nomic-embed-text"
    )
    mem0_enabled: Annotated[str, Field(validation_alias="MEM0_ENABLED")] = "true"
    mem0_collection: Annotated[str, Field(validation_alias="MEM0_COLLECTION")] = (
        "fambrain_user_memories"
    )
    redis_url: Annotated[str, Field(validation_alias="REDIS_URL")] = ""
    redis_enabled: Annotated[str, Field(validation_alias="REDIS_ENABLED")] = ""
    qdrant_url: Annotated[str, Field(validation_alias="QDRANT_URL")] = ""
    qdrant_host: Annotated[str, Field(validation_alias="QDRANT_HOST")] = "127.0.0.1"
    qdrant_port: Annotated[int, Field(validation_alias="QDRANT_PORT")] = 6333
    langsmith_api_key: Annotated[str, Field(validation_alias="LANGSMITH_API_KEY")] = ""
    langchain_api_key: Annotated[str, Field(validation_alias="LANGCHAIN_API_KEY")] = ""
    langsmith_project: Annotated[str, Field(validation_alias="LANGSMITH_PROJECT")] = "fambrain"
    langsmith_tracing: Annotated[str, Field(validation_alias="LANGSMITH_TRACING")] = ""
    corpus_user_id: Annotated[str, Field(validation_alias="FAMBRAIN_CORPUS_USER_ID")] = ""

    @property
    def resolved_jwt_secret(self) -> str:
        """Secret used to sign tokens. Short dev secrets fall back to a placeholder."""
        secret = self.jwt_secret.strip()
        if len(secret) >= 24:
            return secret
        if self.environment == "production":
            raise RuntimeError("JWT_SECRET 长度至少 24（生产环境必需）")
        return "fambrain-dev-only-secret-change-me!!"

    @property
    def cookie_secure(self) -> bool:
        """Whether the auth cookie should be marked Secure."""
        if self.auth_cookie_secure.strip() == "0":
            return False
        return self.environment == "production"

    @property
    def resolved_openai_api_key(self) -> str:
        """OpenAI-compatible key, falling back to the DeepSeek key."""
        return self.openai_api_key.strip() or self.deepseek_api_key.strip()

    @property
    def resolved_ollama_base_url(self) -> str:
        """Ollama base URL, or host plus port when the full URL is empty."""
        explicit = self.ollama_base_url.strip().rstrip("/")
        if explicit:
            return explicit
        return f"http://{self.ollama_host}:{self.ollama_port}"

    @property
    def resolved_qdrant_url(self) -> str:
        """Qdrant base URL, or host plus port when the full URL is empty."""
        explicit = self.qdrant_url.strip().rstrip("/")
        if explicit:
            return explicit
        return f"http://{self.qdrant_host}:{self.qdrant_port}"

    @property
    def redis_configured(self) -> bool:
        """True when a Redis URL is set, or Redis is explicitly enabled."""
        if self.redis_url.strip():
            return True
        return self.redis_enabled.strip() == "1"

    @property
    def mem0_on(self) -> bool:
        """Whether vector memory writes are enabled."""
        return self.mem0_enabled.strip().lower() not in {"", "0", "false", "no"}

    @property
    def langsmith_enabled(self) -> bool:
        """Whether LangSmith tracing should run."""
        if self.langsmith_tracing.strip().lower() == "false":
            return False
        return bool(self.langsmith_api_key.strip() or self.langchain_api_key.strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process settings, building them once."""
    return Settings()
