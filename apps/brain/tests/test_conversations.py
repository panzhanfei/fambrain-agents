from tests.conftest import register_payload, valid_national_id


async def test_conversation_roundtrip(client):
    await client.post("/auth/register", json=register_payload("alice", valid_national_id()))
    created = await client.post("/conversations", json={"title": "晚饭"})
    assert created.status_code == 201
    conversation_id = created.json()["id"]
    assert created.json()["title"] == "晚饭"
    listed = await client.get("/conversations")
    assert listed.status_code == 200
    assert listed.json()["conversations"][0]["id"] == conversation_id
    fetched = await client.get(f"/conversations/{conversation_id}")
    assert fetched.status_code == 200
    assert fetched.json()["title"] == "晚饭"
