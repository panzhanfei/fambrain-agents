from tests.conftest import alt_national_id, register_payload, valid_national_id


async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["service"] == "fambrain-brain"
    assert body["database"]["ping"] is True


async def test_register_login_and_me(client):
    created = await client.post(
        "/auth/register",
        json=register_payload("Alice", valid_national_id()),
    )
    assert created.status_code == 200
    payload = created.json()
    assert payload["bootstrap"] is True
    assert payload["redirect"] == "/"
    assert client.cookies.get("fambrain_token")

    me = await client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "alice"
    assert me.json()["role"] == "ADMIN"
    assert me.json()["status"] == "ACTIVE"

    logged_out = await client.post("/auth/logout")
    assert logged_out.status_code == 200
    denied = await client.get("/auth/me")
    assert denied.status_code == 401

    logged_in = await client.post(
        "/auth/login",
        json={"username": "Alice", "password": "password-1"},
    )
    assert logged_in.status_code == 200
    assert logged_in.json()["redirect"] == "/"


async def test_second_user_is_pending_member(client):
    await client.post("/auth/register", json=register_payload("alice", valid_national_id()))
    admin = await client.get("/auth/me")
    admin_id = admin.json()["id"]
    await client.post("/auth/logout")
    second = await client.post("/auth/register", json=register_payload("bob", alt_national_id()))
    assert second.status_code == 200
    assert second.json()["bootstrap"] is False
    assert second.json()["redirect"] == "/pending"
    me = await client.get("/auth/me")
    assert me.json()["role"] == "MEMBER"
    assert me.json()["status"] == "PENDING"
    assert me.json()["corpusUserId"] == admin_id


async def test_duplicate_username(client):
    body = register_payload("alice", valid_national_id())
    assert (await client.post("/auth/register", json=body)).status_code == 200
    again = await client.post(
        "/auth/register",
        json=register_payload("alice", alt_national_id()),
    )
    assert again.status_code == 409


async def test_bad_password(client):
    await client.post("/auth/register", json=register_payload("alice", valid_national_id()))
    await client.post("/auth/logout")
    failed = await client.post("/auth/login", json={"username": "alice", "password": "nope-nope"})
    assert failed.status_code == 401
