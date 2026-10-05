from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def find_repo_root() -> Path:
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

    environment: str = Field(default="development", validation_alias="FAMBRAIN_ENV")
    database_url: str = Field(
        default="postgresql+psycopg://fambrain:fambrain@127.0.0.1:5432/fambrain",
        validation_alias="FAMBRAIN_DATABASE_URL",
    )
    db_create_all: bool = Field(default=False, validation_alias="FAMBRAIN_DB_CREATE_ALL")
    jwt_secret: str = Field(default="", validation_alias="JWT_SECRET")
    auth_cookie_name: str = "fambrain_token"
    auth_cookie_secure: str = Field(default="", validation_alias="AUTH_COOKIE_SECURE")
    token_max_age_sec: int = 60 * 60 * 24 * 14
    auth_failure_jitter_min_ms: int = 180
    auth_failure_jitter_max_ms: int = 520
    brain_py_host: str = Field(default="127.0.0.1", validation_alias="FAMBRAIN_HOST")
    brain_py_port: int = Field(
        default=3011,
        validation_alias=AliasChoices("BRAIN_SERVICE_PORT", "BRAIN_PY_PORT"),
    )
    chat_provider: str = Field(default="ollama", validation_alias="CHAT_PROVIDER")
    openai_base_url: str = Field(
        default="https://api.deepseek.com",
        validation_alias="OPENAI_BASE_URL",
    )
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    deepseek_api_key: str = Field(default="", validation_alias="DEEPSEEK_API_KEY")
    openai_model: str = Field(default="deepseek-v4-flash", validation_alias="OPENAI_MODEL")
    ollama_base_url: str = Field(default="", validation_alias="OLLAMA_BASE_URL")
    ollama_host: str = Field(default="127.0.0.1", validation_alias="OLLAMA_HOST")
    ollama_port: int = Field(default=11434, validation_alias="OLLAMA_PORT")
    ollama_model: str = Field(default="qwen2.5:14b", validation_alias="OLLAMA_MODEL")
    ollama_embed_model: str = Field(default="nomic-embed-text", validation_alias="OLLAMA_MODEL_EMBED")
    mem0_enabled: str = Field(default="true", validation_alias="MEM0_ENABLED")
    mem0_collection: str = Field(default="fambrain_user_memories", validation_alias="MEM0_COLLECTION")
    redis_url: str = Field(default="", validation_alias="REDIS_URL")
    redis_enabled: str = Field(default="", validation_alias="REDIS_ENABLED")
    qdrant_url: str = Field(default="", validation_alias="QDRANT_URL")
    qdrant_host: str = Field(default="127.0.0.1", validation_alias="QDRANT_HOST")
    qdrant_port: int = Field(default=6333, validation_alias="QDRANT_PORT")
    langsmith_api_key: str = Field(default="", validation_alias="LANGSMITH_API_KEY")
    langchain_api_key: str = Field(default="", validation_alias="LANGCHAIN_API_KEY")
    langsmith_project: str = Field(default="fambrain", validation_alias="LANGSMITH_PROJECT")
    langsmith_tracing: str = Field(default="", validation_alias="LANGSMITH_TRACING")
    corpus_user_id: str = Field(default="", validation_alias="FAMBRAIN_CORPUS_USER_ID")

    @property
    def resolved_jwt_secret(self) -> str:
        secret = self.jwt_secret.strip()
        if len(secret) >= 24:
            return secret
        if self.environment == "production":
            raise RuntimeError("JWT_SECRET 长度至少 24（生产环境必需）")
        return "fambrain-dev-only-secret-change-me!!"

    @property
    def cookie_secure(self) -> bool:
        if self.auth_cookie_secure.strip() == "0":
            return False
        return self.environment == "production"

    @property
    def resolved_openai_api_key(self) -> str:
        return self.openai_api_key.strip() or self.deepseek_api_key.strip()

    @property
    def resolved_ollama_base_url(self) -> str:
        explicit = self.ollama_base_url.strip().rstrip("/")
        if explicit:
            return explicit
        return f"http://{self.ollama_host}:{self.ollama_port}"

    @property
    def resolved_qdrant_url(self) -> str:
        explicit = self.qdrant_url.strip().rstrip("/")
        if explicit:
            return explicit
        return f"http://{self.qdrant_host}:{self.qdrant_port}"

    @property
    def redis_configured(self) -> bool:
        if self.redis_url.strip():
            return True
        return self.redis_enabled.strip() == "1"

    @property
    def mem0_on(self) -> bool:
        return self.mem0_enabled.strip().lower() not in {"", "0", "false", "no"}

    @property
    def langsmith_enabled(self) -> bool:
        if self.langsmith_tracing.strip().lower() == "false":
            return False
        return bool(self.langsmith_api_key.strip() or self.langchain_api_key.strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
