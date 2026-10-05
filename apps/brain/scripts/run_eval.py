"""Run FamBrain golden.json against the Python pipeline.

    uv run python scripts/run_eval.py
    uv run python scripts/run_eval.py --km-only
    uv run python scripts/run_eval.py --case G1,G2,K1
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

from fambrain_agentflow.chat.client import build_chat
from fambrain_agentflow.corpus.search import list_corpus_entries, search_corpus
from fambrain_agentflow.eval.assert_golden import (
    KmSnapshot,
    PipelineSnapshot,
    assert_km,
    assert_pipeline,
)
from fambrain_agentflow.execution.turns import TurnRegistry
from fambrain_agentflow.pipeline.execute import iter_full_turn
from fambrain_agentflow.types import ChatTurn, PipelineContext
from fambrain_kernel.config import find_repo_root, get_settings

GOLDEN = find_repo_root() / "apps" / "brain" / "eval" / "golden.json"


def _corpus_user() -> str:
    configured = get_settings().corpus_user_id.strip()
    if configured:
        return configured
    users = find_repo_root() / "data" / "doc" / "users"
    if users.is_dir():
        for child in sorted(users.iterdir()):
            if (child / "corpus").is_dir():
                return child.name
    return "local"


def _list(case: dict) -> tuple[bool, list[str]]:
    spec = case.get("list") or {}
    kind = spec.get("listKind") or "project"
    action = spec.get("action") or "preview"
    page = int(spec.get("page") or 1)
    page_size = int(spec.get("pageSize") or (8 if action == "preview" else 20))
    started = time.perf_counter()
    hits = list_corpus_entries(_corpus_user(), kind)
    start = max(page - 1, 0) * page_size
    page_hits = hits[start : start + page_size]
    notes = f"列举分页 {page}：{len(page_hits)}/{len(hits)} 个"
    snap = KmSnapshot(
        hits=[{"path": hit.path, "excerpt": hit.excerpt, "relevance": hit.score} for hit in page_hits],
        coverage="sufficient" if page_hits else "none",
        notes=notes,
        query_profile="enumeration",
        candidate_count=len(hits),
        confidence_tier="high" if page_hits else "low",
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
    issues = assert_km(snap, case.get("assert") or {})
    return not issues, issues


def _km(case: dict) -> tuple[bool, list[str]]:
    spec = case["km"]
    started = time.perf_counter()
    hits = search_corpus(
        _corpus_user(),
        spec.get("searchQuery") or "",
        query_type=spec.get("queryType") or "default",
        topics=spec.get("topics") or [],
    )
    tier = "high" if hits and hits[0].score >= 1 else ("medium" if hits else "low")
    snap = KmSnapshot(
        hits=[{"path": hit.path, "excerpt": hit.excerpt, "relevance": hit.score} for hit in hits],
        coverage="sufficient" if hits else "none",
        notes=None,
        query_profile=spec.get("queryType") or "default",
        candidate_count=len(hits),
        confidence_tier=tier,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
    issues = assert_km(snap, case.get("assert") or {})
    return not issues, issues


async def _pipeline_case(case: dict, chat, turns: TurnRegistry) -> tuple[bool, list[str], str]:
    question = case.get("question") or ""
    history = [ChatTurn(role=turn["role"], content=turn["content"]) for turn in case.get("history") or []]
    history.append(ChatTurn(role="user", content=question))
    context = PipelineContext(
        actorUserId="eval",
        corpusUserId=_corpus_user(),
        displayName="评测",
        conversationId=f"eval-{case['id']}",
    )
    answer = ""
    steps: list[str] = []
    error = None
    async for name, payload in iter_full_turn(history, context, chat, turns):
        if name == "error":
            error = payload.get("message")
        if name == "pipeline_done":
            answer = payload.get("answer") or ""
            steps = [item["name"] for item in payload.get("steps") or []]
    snap = PipelineSnapshot(steps=steps, answer=answer, error=error, hit_count=0)
    issues = assert_pipeline(snap, case.get("assert") or {})
    return not issues, issues, answer


async def _turn_probe(probe: dict, chat, turns: TurnRegistry) -> list[tuple[str, bool, list[str], str]]:
    """Same-session turns share history. A conversationSuffix starts a fresh thread."""
    rows: list[tuple[str, bool, list[str], str]] = []
    history: list[dict] = []
    prefix = probe.get("conversationIdPrefix") or probe["id"]
    for index, turn in enumerate(probe["turns"]):
        if turn.get("conversationSuffix"):
            history = []
            case_id = f"{prefix}-{turn['conversationSuffix']}"
        else:
            case_id = f"{prefix}-{index}"
        ok, issues, answer = await _pipeline_case(
            {
                "id": case_id,
                "question": turn["question"],
                "history": history,
                "assert": turn["assert"],
            },
            chat,
            turns,
        )
        history = [
            *history,
            {"role": "user", "content": turn["question"]},
            {"role": "assistant", "content": answer},
        ]
        rows.append((f"{probe['id']} {turn['question']}", ok, issues, answer))
    return rows


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", default="")
    parser.add_argument("--km-only", action="store_true")
    parser.add_argument("--pipeline-only", action="store_true")
    parser.add_argument("--skip-mem", action="store_true")
    args = parser.parse_args()
    document = json.loads(GOLDEN.read_text(encoding="utf-8"))
    wanted = {item.strip() for item in args.case.split(",") if item.strip()}
    settings = get_settings()
    chat = build_chat(settings)
    turns = TurnRegistry()
    failed = 0
    ran = 0
    lines: list[str] = ["# Python eval", ""]
    for case in document["cases"]:
        if wanted and case["id"] not in wanted:
            continue
        tier = case.get("tier")
        if args.km_only and tier != "km":
            continue
        if args.pipeline_only and tier != "pipeline":
            continue
        if tier == "km":
            ok, issues = _km(case)
            preview = ""
        elif tier == "list":
            ok, issues = _list(case)
            preview = ""
        elif tier == "pipeline":
            ok, issues, preview = await _pipeline_case(case, chat, turns)
        else:
            continue
        ran += 1
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {case['id']} {case.get('label', '')}")
        lines.append(f"- {mark} {case['id']} {case.get('label', '')}")
        if not ok:
            failed += 1
            for issue in issues:
                print(f"    - {issue}")
                lines.append(f"  - {issue}")
            if preview:
                print(f"    answer: {preview[:180].replace(chr(10), ' ')}")
    probe_keys = (
        "memProbe",
        "cacheProbe",
        "profileProbe",
        "familyProbe",
        "fiveCompositeProbe",
        "identityCompositeProbe",
    )
    if not args.km_only and not args.pipeline_only and not args.skip_mem:
        for key in probe_keys:
            probe = document.get(key)
            if not probe or not probe.get("turns"):
                continue
            if wanted and probe.get("id") not in wanted:
                continue
            for label, ok, issues, answer in await _turn_probe(probe, chat, turns):
                ran += 1
                mark = "PASS" if ok else "FAIL"
                print(f"[{mark}] {label}")
                lines.append(f"- {mark} {label}")
                if not ok:
                    failed += 1
                    for issue in issues:
                        print(f"    - {issue}")
                        lines.append(f"  - {issue}")
                    if answer:
                        print(f"    answer: {answer[:180].replace(chr(10), ' ')}")
    report = find_repo_root() / "reports" / "py-eval-report.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    lines.extend(["", f"ran {ran}, failed {failed}", ""])
    lines.append(
        "未跑：listPagination / dualListPagination（续页游标）、"
        "vaultWorkspace（jobId 暂停恢复）、dagFree（synthesize_merge 夹具）。"
    )
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{ran} cases, {failed} failed. report: {report}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
