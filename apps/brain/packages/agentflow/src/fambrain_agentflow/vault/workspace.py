"""原文库工作台：列出目录并给出打开、新建、删除、结束按钮。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from fambrain_corpus.workspace import materialize_workspace_txt, purge_workspace_txts

from fambrain_agentflow.intake.parse import PlanStep
from fambrain_agentflow.tools.execute import workspace_root
from fambrain_agentflow.types import ResumePayload

_LIST = "__FAMBRAIN_VAULT_WS_LIST__:"
_OPEN = "__FAMBRAIN_VAULT_WS_OPEN__:"
_CREATE_FILE = "__FAMBRAIN_VAULT_WS_CREATE_FILE__:"
_CREATE_FOLDER = "__FAMBRAIN_VAULT_WS_CREATE_FOLDER__:"
_DELETE_FILE = "__FAMBRAIN_VAULT_WS_DELETE_FILE__:"
_DELETE_FOLDER = "__FAMBRAIN_VAULT_WS_DELETE_FOLDER__:"
_DONE = "__FAMBRAIN_VAULT_WS_DONE__"
_EXACT_OPEN = "我的原文库"


@dataclass(frozen=True)
class VaultRequest:
    operation: str
    target_path: str = ""
    name: str | None = None
    after_content: str | None = None


@dataclass(frozen=True)
class WorkspaceView:
    answer: str
    blocks: list[dict]
    paused: bool
    job_id: str | None


def is_direct_vault_turn(question: str, resume: ResumePayload | None) -> bool:
    """按钮 exact-match 和 Resume 不经过 Intake。"""
    if resume is not None and resume.kind == "vault_action":
        return True
    text = question.strip()
    if text == _EXACT_OPEN:
        return True
    return text.startswith("__FAMBRAIN_VAULT_WS_")


def vault_request_from_turn(
    question: str,
    resume: ResumePayload | None,
    step: PlanStep | None,
) -> VaultRequest | None:
    if resume is not None and resume.kind == "vault_action":
        parsed = _from_prompt((resume.prompt or question).strip())
        if parsed is None:
            parsed = VaultRequest("list")
        if resume.after_content is not None and parsed.operation == "open":
            return VaultRequest("update", parsed.target_path, None, resume.after_content)
        if resume.name and parsed.operation == "create_file":
            return VaultRequest(
                "create_file",
                parsed.target_path,
                f"{resume.name}.txt",
                parsed.after_content,
            )
        if resume.name and parsed.operation == "create_folder":
            return VaultRequest(
                "create_folder",
                parsed.target_path,
                resume.name,
                parsed.after_content,
            )
        return parsed
    text = question.strip()
    if text == _EXACT_OPEN:
        return VaultRequest("list")
    parsed = _from_prompt(text)
    if parsed is not None:
        return parsed
    if step is not None and step.kind == "vault_workspace":
        return _from_step(step)
    return None


def _from_prompt(text: str) -> VaultRequest | None:
    if text == _DONE:
        return VaultRequest("done")
    for prefix, operation in (
        (_LIST, "list"),
        (_OPEN, "open"),
        (_CREATE_FILE, "create_file"),
        (_CREATE_FOLDER, "create_folder"),
        (_DELETE_FILE, "delete_file"),
        (_DELETE_FOLDER, "delete_folder"),
    ):
        if text.startswith(prefix):
            return VaultRequest(operation, text[len(prefix) :].strip().lstrip("/"))
    return None


def _from_step(step: PlanStep) -> VaultRequest:
    params = step.params or {}
    operation = str(params.get("operation") or "list")
    after = params.get("afterContent")
    after_text = str(after) if after is not None else None
    if operation == "update" and not (after_text or "").strip():
        operation = "open"
    name = params.get("name")
    return VaultRequest(
        operation,
        str(params.get("targetPath") or "").strip().lstrip("/"),
        str(name).strip() if name else None,
        after_text,
    )


def apply_workspace(
    corpus_user_id: str,
    request: VaultRequest,
    *,
    root: Path | None = None,
    job_id: str | None = None,
) -> WorkspaceView:
    base = root if root is not None else workspace_root(corpus_user_id)
    base.mkdir(parents=True, exist_ok=True)
    if request.operation == "done":
        return WorkspaceView("已结束原文库编辑。", [], False, job_id)
    notice, cwd = _mutate(base, corpus_user_id, request)
    answer, blocks = _board(base, cwd, notice)
    return WorkspaceView(answer, blocks, True, job_id or str(uuid.uuid4()))


def iter_workspace_events(
    turn_id: str,
    corpus_user_id: str,
    request: VaultRequest,
    steps_done: list[dict],
    *,
    root: Path | None = None,
    job_id: str | None = None,
) -> Iterator[tuple[str, dict]]:
    for name in ("file_handoff", "file_agent"):
        yield _step(name, "running")
        yield _step(name, "done")
        steps_done.append({"name": name, "status": "done", "durationMs": 0})
    view = apply_workspace(corpus_user_id, request, root=root, job_id=job_id)
    if view.paused:
        yield (
            "paused",
            {
                "type": "paused",
                "turnId": turn_id,
                "kind": "vault_wait",
                "answer": view.answer,
                "blocks": view.blocks,
                "jobId": view.job_id,
            },
        )
    yield ("assistant", {"type": "assistant", "text": view.answer})
    yield (
        "assistant_message",
        {
            "type": "assistant_message",
            "message": {"plainText": view.answer, "blocks": view.blocks, "citations": []},
        },
    )
    timing = {"totalMs": 0, "ttftMs": None, "nodes": {}}
    yield ("pipeline_timing", {"type": "pipeline_timing", "timing": timing})
    yield (
        "pipeline_done",
        {
            "answer": view.answer,
            "blocks": view.blocks,
            "citations": [],
            "retrievalPaths": [],
            "timing": timing,
            "logs": [],
            "steps": steps_done,
            "aborted": False,
            "paused": view.paused,
            "pauseKind": "vault_wait" if view.paused else None,
            "jobId": view.job_id,
            "turnId": turn_id,
        },
    )


def _mutate(root: Path, corpus_user_id: str, request: VaultRequest) -> tuple[str, str]:
    operation = request.operation
    target = request.target_path
    if operation == "list":
        folder = _safe(root, target)
        if folder is None or not folder.is_dir():
            return "没有这个文件夹。", ""
        return "", target
    if operation == "open":
        file = _safe(root, target)
        if file is None or not file.is_file():
            return "没有这个文件。", _parent(target)
        body = file.read_text(encoding="utf-8", errors="ignore")[:4000]
        return f"{target}\n\n{body}".strip(), _parent(target)
    if operation == "create_file":
        name = _safe_name(request.name) or f"untitled-{uuid.uuid4().hex[:8]}.txt"
        if not name.lower().endswith(".txt"):
            name = f"{name}.txt"
        parent = _dir_or_parent(root, target)
        if parent is None:
            return "路径超出原文库。", ""
        parent.mkdir(parents=True, exist_ok=True)
        file = parent / name
        rel = file.relative_to(root.resolve()).as_posix()
        parent_rel = parent.relative_to(root.resolve()).as_posix()
        cwd = "" if parent == root.resolve() else parent_rel
        if file.exists():
            return f"已经有 {rel}。", cwd
        body = request.after_content or ""
        file.write_text(body, encoding="utf-8")
        return f"已新建 {rel}\n{_materialize_note(corpus_user_id, rel, body)}", cwd
    if operation == "create_folder":
        name = _safe_name(request.name) or f"folder-{uuid.uuid4().hex[:8]}"
        parent = _dir_or_parent(root, target)
        if parent is None:
            return "路径超出原文库。", ""
        name_path = parent / name
        rel = name_path.relative_to(root.resolve()).as_posix()
        parent_rel = parent.relative_to(root.resolve()).as_posix()
        cwd = "" if parent == root.resolve() else parent_rel
        if name_path.exists():
            return f"已经有文件夹 {rel}。", cwd
        name_path.mkdir(parents=True, exist_ok=True)
        return f"已新建文件夹 {rel}", cwd
    if operation == "update":
        file = _safe(root, target)
        if file is None or not file.is_file():
            return "没有这个文件。", _parent(target)
        body = request.after_content or ""
        file.write_text(body, encoding="utf-8")
        return f"已更新 {target}\n{_materialize_note(corpus_user_id, target, body)}", _parent(target)
    if operation in {"delete_file", "delete_folder"}:
        destination = _safe(root, target)
        if destination is None or destination == root.resolve() or not destination.exists():
            return "没有这个路径。", _parent(target)
        txts = _txt_rels(root, destination)
        if destination.is_file():
            destination.unlink()
        else:
            for child in sorted(destination.rglob("*"), reverse=True):
                if child.is_file() or child.is_symlink():
                    child.unlink()
                elif child.is_dir():
                    child.rmdir()
            destination.rmdir()
        return f"已硬删除 {target}\n{_purge_note(corpus_user_id, txts)}", _parent(target)
    return "不支持的原文库操作。", ""


def _materialize_note(corpus_user_id: str, rel: str, txt_body: str) -> str:
    try:
        return materialize_workspace_txt(corpus_user_id, rel, txt_body=txt_body).detail
    except Exception as exc:
        return f"语料同步失败：{exc}"


def _purge_note(corpus_user_id: str, rels: list[str]) -> str:
    try:
        return purge_workspace_txts(corpus_user_id, rels).detail
    except Exception as exc:
        return f"语料同步失败：{exc}"


def _txt_rels(root: Path, destination: Path) -> list[str]:
    base = root.resolve()
    if destination.is_file():
        if destination.suffix.lower() != ".txt":
            return []
        return [destination.relative_to(base).as_posix()]
    return [
        path.relative_to(base).as_posix()
        for path in sorted(destination.rglob("*"))
        if path.is_file() and path.suffix.lower() == ".txt"
    ]


def _board(root: Path, cwd: str, notice: str) -> tuple[str, list[dict]]:
    folder = _safe(root, cwd)
    lines = [notice] if notice else []
    title = f"原文库 / {cwd}" if cwd else "原文库"
    lines.append(title)
    actions: list[dict] = []
    if folder is None or not folder.is_dir():
        lines.append("没有这个文件夹。")
    else:
        children = sorted(folder.iterdir(), key=lambda path: (path.is_file(), path.name))
        if not children:
            lines.append("这里是空的。")
        for child in children:
            rel = child.relative_to(root.resolve()).as_posix()
            if child.is_dir():
                lines.append(f"[文件夹] {rel}")
                actions.append(_action(f"open-dir-{rel}", f"打开 {child.name}", f"{_LIST}{rel}", f"打开 {rel}"))
                actions.append(
                    _action(f"del-dir-{rel}", f"删除 {child.name}", f"{_DELETE_FOLDER}{rel}", f"删除 {rel}")
                )
            elif child.is_file():
                lines.append(rel)
                actions.append(
                    _action(
                        f"open-{rel}",
                        f"编辑 {child.name}",
                        f"{_OPEN}{rel}",
                        f"编辑 {rel}",
                        "open_editor",
                    )
                )
                actions.append(
                    _action(f"del-{rel}", f"删除 {child.name}", f"{_DELETE_FILE}{rel}", f"删除 {rel}")
                )
    if cwd:
        actions.append(_action("up", "返回上级", f"{_LIST}{_parent(cwd)}", "返回上级"))
    actions.append(_action("create-file", "新建 txt", f"{_CREATE_FILE}{cwd}", "新建 txt"))
    actions.append(_action("create-folder", "新建文件夹", f"{_CREATE_FOLDER}{cwd}", "新建文件夹"))
    actions.append(_action("done", "结束", _DONE, "结束"))
    answer = "\n".join(line for line in lines if line).strip()
    blocks = [
        {"type": "text", "markdown": answer},
        {"type": "actions", "actions": actions},
    ]
    return answer, blocks


def _action(
    action_id: str,
    label: str,
    prompt: str,
    display: str,
    handler: str = "chat",
) -> dict:
    return {
        "id": action_id,
        "label": label,
        "prompt": prompt,
        "displayText": display,
        "clientHandler": handler,
    }


def _safe(root: Path, rel: str) -> Path | None:
    base = root.resolve()
    destination = (base / rel).resolve() if rel else base
    if destination != base and base not in destination.parents:
        return None
    return destination


def _dir_or_parent(root: Path, rel: str) -> Path | None:
    destination = _safe(root, rel)
    if destination is None:
        return None
    if destination.is_dir():
        return destination
    parent = destination.parent
    base = root.resolve()
    if parent == base or base in parent.parents:
        return parent
    return None


def _parent(rel: str) -> str:
    if not rel or "/" not in rel:
        return ""
    return rel.rsplit("/", 1)[0]


def _safe_name(name: str | None) -> str | None:
    if not name:
        return None
    cleaned = Path(name).name.replace("..", "").strip()
    return cleaned or None


def _step(name: str, status: str) -> tuple[str, dict]:
    payload: dict = {"type": "step", "name": name, "status": status}
    if status == "done":
        payload["durationMs"] = 0
    return "step", payload
