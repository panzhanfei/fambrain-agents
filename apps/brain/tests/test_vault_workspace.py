from pathlib import Path

import pytest
from fambrain_agentflow.execution.turns import TurnRegistry
from fambrain_agentflow.pipeline.execute import iter_full_turn
from fambrain_agentflow.types import ChatTurn, PipelineContext, ResumePayload
from fambrain_agentflow.vault.workspace import VaultRequest, apply_workspace
from fambrain_corpus.workspace import CorpusSyncResult


@pytest.fixture(autouse=True)
def _stub_corpus_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "fambrain_agentflow.vault.workspace.materialize_workspace_txt",
        lambda corpus_user_id, rel, *, txt_body: CorpusSyncResult(True, "已写入语料并更新向量库"),
    )
    monkeypatch.setattr(
        "fambrain_agentflow.vault.workspace.purge_workspace_txts",
        lambda corpus_user_id, rels: CorpusSyncResult(True, "已删除对应语料与向量"),
    )


class _BoomChat:
    async def complete_text(self, system: str, user: str, *, json_mode: bool = False) -> str:
        del system, user, json_mode
        raise AssertionError("原文库按钮不应再问模型")


def _context(resume: ResumePayload | None = None) -> PipelineContext:
    return PipelineContext(
        actorUserId="user-1",
        corpusUserId="user-1",
        displayName="甲",
        conversationId="conv-1",
        turnId="turn-1",
        resume=resume,
    )


def test_workspace_lists_create_and_delete_buttons(tmp_path: Path) -> None:
    (tmp_path / "note.txt").write_text("hello", encoding="utf-8")
    view = apply_workspace("user-1", VaultRequest("list"), root=tmp_path)
    labels = [action["label"] for action in view.blocks[1]["actions"]]
    assert view.paused is True
    assert view.job_id
    assert "新建 txt" in labels
    assert "结束" in labels
    assert "编辑 note.txt" in labels
    assert "删除 note.txt" in labels


def test_create_file_then_hard_delete(tmp_path: Path) -> None:
    created = apply_workspace("user-1", VaultRequest("create_file"), root=tmp_path)
    assert "已新建 " in created.answer
    name = created.answer.split("已新建 ", 1)[1].split()[0]
    assert (tmp_path / name).is_file()
    deleted = apply_workspace("user-1", VaultRequest("delete_file", name), root=tmp_path)
    assert f"已硬删除 {name}" in deleted.answer
    assert not (tmp_path / name).exists()
    assert deleted.paused is True


@pytest.mark.asyncio
async def test_exact_library_prompt_pauses_without_model(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "fambrain_agentflow.vault.workspace.workspace_root",
        lambda corpus_user_id: tmp_path,
    )
    events = [
        event
        async for event in iter_full_turn(
            [ChatTurn(role="user", content="我的原文库")],
            _context(),
            _BoomChat(),
            TurnRegistry(),
        )
    ]
    paused = next(payload for name, payload in events if name == "paused")
    done = next(payload for name, payload in events if name == "pipeline_done")
    assert paused["kind"] == "vault_wait"
    assert paused["jobId"]
    assert done["paused"] is True
    assert done["jobId"] == paused["jobId"]
    labels = [action["label"] for action in done["blocks"][1]["actions"]]
    assert "新建 txt" in labels


@pytest.mark.asyncio
async def test_resume_done_closes_workbench(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "fambrain_agentflow.vault.workspace.workspace_root",
        lambda corpus_user_id: tmp_path,
    )
    events = [
        event
        async for event in iter_full_turn(
            [ChatTurn(role="user", content="结束")],
            _context(
                ResumePayload(
                    kind="vault_action",
                    jobId="job-1",
                    prompt="__FAMBRAIN_VAULT_WS_DONE__",
                )
            ),
            _BoomChat(),
            TurnRegistry(),
        )
    ]
    done = next(payload for name, payload in events if name == "pipeline_done")
    assert done["paused"] is False
    assert done["answer"] == "已结束原文库编辑。"
    assert not any(name == "paused" for name, _payload in events)


@pytest.mark.asyncio
async def test_resume_reuses_job_id(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "fambrain_agentflow.vault.workspace.workspace_root",
        lambda corpus_user_id: tmp_path,
    )
    events = [
        event
        async for event in iter_full_turn(
            [ChatTurn(role="user", content="新建 txt")],
            _context(
                ResumePayload(
                    kind="vault_action",
                    jobId="job-keep",
                    prompt="__FAMBRAIN_VAULT_WS_CREATE_FILE__:",
                )
            ),
            _BoomChat(),
            TurnRegistry(),
        )
    ]
    paused = next(payload for name, payload in events if name == "paused")
    done = next(payload for name, payload in events if name == "pipeline_done")
    assert paused["jobId"] == "job-keep"
    assert done["jobId"] == "job-keep"


@pytest.mark.asyncio
async def test_resume_create_uses_given_name(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "fambrain_agentflow.vault.workspace.workspace_root",
        lambda corpus_user_id: tmp_path,
    )
    events = [
        event
        async for event in iter_full_turn(
            [ChatTurn(role="user", content="备忘")],
            _context(
                ResumePayload(
                    kind="vault_action",
                    jobId="job-keep",
                    prompt="__FAMBRAIN_VAULT_WS_CREATE_FILE__:",
                    name="备忘",
                )
            ),
            _BoomChat(),
            TurnRegistry(),
        )
    ]
    paused = next(payload for name, payload in events if name == "paused")
    assert "已新建 备忘.txt" in paused["answer"]
    assert (tmp_path / "备忘.txt").is_file()
    assert paused["jobId"] == "job-keep"


@pytest.mark.asyncio
async def test_resume_edit_writes_body(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "fambrain_agentflow.vault.workspace.workspace_root",
        lambda corpus_user_id: tmp_path,
    )
    (tmp_path / "亲属.txt").write_text("", encoding="utf-8")
    events = [
        event
        async for event in iter_full_turn(
            [ChatTurn(role="user", content="保存")],
            _context(
                ResumePayload(
                    kind="vault_action",
                    jobId="job-keep",
                    prompt="__FAMBRAIN_VAULT_WS_OPEN__:亲属.txt",
                    afterContent="爸爸",
                )
            ),
            _BoomChat(),
            TurnRegistry(),
        )
    ]
    paused = next(payload for name, payload in events if name == "paused")
    assert "已更新 亲属.txt" in paused["answer"]
    assert "已写入语料并更新向量库" in paused["answer"]
    assert (tmp_path / "亲属.txt").read_text(encoding="utf-8") == "爸爸"


def test_update_sends_body_to_materialize(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, str] = {}

    def _save(corpus_user_id: str, rel: str, *, txt_body: str) -> CorpusSyncResult:
        seen["id"] = corpus_user_id
        seen["rel"] = rel
        seen["body"] = txt_body
        return CorpusSyncResult(True, "已写入语料并更新向量库")

    monkeypatch.setattr("fambrain_agentflow.vault.workspace.materialize_workspace_txt", _save)
    (tmp_path / "亲属.txt").write_text("旧", encoding="utf-8")
    view = apply_workspace(
        "user-1",
        VaultRequest("update", "亲属.txt", None, "我的儿子叫小名"),
        root=tmp_path,
    )
    assert seen == {"id": "user-1", "rel": "亲属.txt", "body": "我的儿子叫小名"}
    assert "已写入语料并更新向量库" in view.answer


def test_delete_folder_purges_nested_txt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    purged: list[list[str]] = []

    def _purge(corpus_user_id: str, rels: list[str]) -> CorpusSyncResult:
        del corpus_user_id
        purged.append(rels)
        return CorpusSyncResult(True, "已删除对应语料与向量")

    monkeypatch.setattr("fambrain_agentflow.vault.workspace.purge_workspace_txts", _purge)
    folder = tmp_path / "家"
    folder.mkdir()
    (folder / "亲属.txt").write_text("爸爸", encoding="utf-8")
    view = apply_workspace("user-1", VaultRequest("delete_folder", "家"), root=tmp_path)
    assert purged == [["家/亲属.txt"]]
    assert "已硬删除 家" in view.answer
    assert "已删除对应语料与向量" in view.answer
    assert not folder.exists()
