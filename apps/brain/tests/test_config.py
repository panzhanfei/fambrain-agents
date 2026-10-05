from fambrain_kernel.config import Settings


def test_short_jwt_secret_uses_dev_placeholder():
    settings = Settings(environment="test", jwt_secret="short", database_url="sqlite+aiosqlite://")
    assert len(settings.resolved_jwt_secret) >= 24


def test_production_rejects_short_jwt_secret():
    settings = Settings(environment="production", jwt_secret="short", database_url="sqlite+aiosqlite://")
    try:
        _ = settings.resolved_jwt_secret
    except RuntimeError as exc:
        assert "JWT_SECRET" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")
