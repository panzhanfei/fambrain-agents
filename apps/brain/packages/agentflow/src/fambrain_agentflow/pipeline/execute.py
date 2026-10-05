from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import date
from pathlib import Path

from fambrain_agentflow.chat.client import ChatCompleter
from fambrain_agentflow.corpus.search import CorpusHit, list_corpus_entries, search_corpus
from fambrain_agentflow.execution.turns import TurnRegistry
from fambrain_agentflow.ingest.docling import parse_to_markdown
from fambrain_agentflow.intake.parse import IntakePlan, PlanStep, parse_intake
from fambrain_agentflow.intake.prompt import intake_system_prompt
from fambrain_agentflow.memory.facts import recall_fact, remember_fact
from fambrain_agentflow.tools.execute import (
    age_line,
    extract_identity,
    extract_links,
    run_vault,
    run_weather,
)
from fambrain_agentflow.types import ChatTurn, PipelineContext, latest_user_text

_ANALYST = (
    "你是 FamBrain 的归纳回答。只用下面给出的检索、列举、记忆和工具结果作答，使用简体中文。"
    "有姓名、数字、链接、气温就原文写出。没有依据时说明不知道，不要编造。"
)


def _step_event(name: str, status: str) -> tuple[str, dict]:
    payload: dict = {"type": "step", "name": name, "status": status}
    if status == "done":
        payload["durationMs"] = 0
    return "step", payload


def _history_block(history: list[ChatTurn]) -> str:
    lines = []
    for turn in history[-8:]:
        lines.append(f"{turn.role}: {turn.content}")
    return "\n".join(lines)


async def _translate(chat: ChatCompleter, text: str, target_lang: str | None) -> str:
    lang = target_lang or "zh"
    return await chat.complete_text(
        f"把用户给出的文本翻译成 {lang}。只输出译文。",
        text,
    )


async def _run_step(
    step: PlanStep,
    corpus_user_id: str,
    chat: ChatCompleter,
) -> tuple[str, list[CorpusHit]]:
    hits: list[CorpusHit] = []
    if step.kind == "km":
        hits = search_corpus(
            corpus_user_id,
            step.search_query,
            query_type=step.query_type,
            topics=step.topics,
        )
        lines = [f"[{hit.path}] {hit.excerpt}" for hit in hits] or ["无命中"]
        extra = ""
        if step.tool_id == "compute_age_from_hits":
            extra = age_line(hits, date.today()) or "没有从命中里算出年龄"
        elif step.tool_id == "extract_identity_from_hits":
            extra = extract_identity(hits, step.identity_field) or "没有抽出字段"
        elif step.tool_id == "extract_external_links_from_hits":
            links = extract_links(hits)
            extra = "\n".join(links) or "没有抽出链接"
        text = f"{step.label}\n" + "\n".join(lines)
        if extra:
            text += f"\n工具结果：{extra}"
        return text, hits
    if step.kind == "list":
        control = step.enumeration or {}
        list_kind = str(control.get("listKind") or "project")
        exclude = control.get("excludeHint")
        hits = list_corpus_entries(
            corpus_user_id,
            list_kind,
            exclude_hint=str(exclude) if exclude else None,
        )
        names = [hit.path.rsplit("/", 1)[-1].removesuffix(".md") for hit in hits]
        return f"{step.label}：" + ("、".join(names) if names else "没有条目"), hits
    if step.kind == "mem":
        key = step.user_fact_key or ""
        found = recall_fact(corpus_user_id, key) if key else None
        if found:
            return f"{found.get('label') or key}：{found.get('value')}", hits
        try:
            from fambrain_memory import search_user_memories

            memories = search_user_memories(corpus_user_id, step.search_query or key)
        except Exception:
            memories = []
        if memories:
            return "\n".join(memories), hits
        return f"没有记住 {step.user_fact_label or key}", hits
    if step.kind == "tool":
        if step.tool_id == "get_weather":
            try:
                return await run_weather(step.search_query), hits
            except Exception as exc:
                return f"天气查询失败：{exc}", hits
        if step.tool_id == "translate_text":
            translated = await _translate(chat, step.search_query, step.target_lang)
            return translated, hits
        return f"{step.tool_id or 'tool'}：{step.search_query}", hits
    if step.kind == "dag":
        parts: list[str] = []
        carried = ""
        for node in step.nodes or []:
            tool_id = str(node.get("toolId") or "")
            query = str(node.get("searchQuery") or step.search_query)
            if tool_id == "retrieve_corpus":
                hits = search_corpus(corpus_user_id, query, query_type=step.query_type, topics=step.topics)
                carried = "\n".join(hit.excerpt for hit in hits[:2])
                parts.append(carried or "无命中")
            elif tool_id == "translate_text":
                translated = await _translate(chat, carried or query, node.get("targetLang"))
                parts.append(translated)
                carried = translated
            elif tool_id == "synthesize_merge":
                parts.append(carried)
        return "\n".join(parts), hits
    if step.kind == "vault_workspace":
        return run_vault(corpus_user_id, step.params), hits
    if step.kind == "summarize":
        return step.search_query, hits
    return step.label, hits


def _step_name(kind: str) -> str:
    return {
        "km": "km_retrieve",
        "list": "list_retrieve",
        "mem": "user_fact",
        "tool": "tool_retrieve",
        "summarize": "content_summarizer",
        "dag": "plan_dag",
        "vault_workspace": "file_handoff",
    }.get(kind, "km_retrieve")


async def iter_full_turn(
    history: list[ChatTurn],
    context: PipelineContext,
    chat: ChatCompleter,
    turns: TurnRegistry,
) -> AsyncIterator[tuple[str, dict]]:
    turn_id = context.turn_id or str(uuid.uuid4())
    question = latest_user_text(history)
    if context.attachment_batch_id:
        from fambrain_agentflow.ingest.attachments import attachment_text

        attached = attachment_text(context.attachment_batch_id, context.actor_user_id)
        if attached:
            question = f"{question}\n\n附件内容：\n{attached}"
    turns.start(turn_id, actor_user_id=context.actor_user_id, conversation_id=context.conversation_id)
    steps_done: list[dict] = []
    answer = ""
    hit_paths: list[str] = []
    try:
        for name in ("prepare_turn_start", "intake"):
            yield _step_event(name, "running")
            yield _step_event(name, "done")
            steps_done.append({"name": name, "status": "done", "durationMs": 0})
        if not question:
            plan = IntakePlan(intent="clarify", clarifying_question="请把问题说得更具体一些。")
        else:
            raw = await chat.complete_text(
                intake_system_prompt(),
                f"称呼：{context.display_name}\n历史：\n{_history_block(history)}\n最新问题：{question}",
                json_mode=True,
            )
            plan = parse_intake(raw)
        if plan.user_fact_key and plan.user_fact_value:
            remember_fact(
                context.corpus_user_id,
                plan.user_fact_key,
                plan.user_fact_value,
                plan.user_fact_label,
            )
        evidence: list[str] = []
        executed: list[str] = []
        if plan.intent in {"chitchat", "out_of_scope", "direct_answer", "clarify"} and not plan.steps:
            if plan.intent == "clarify":
                answer = plan.clarifying_question or "请把问题说得更具体一些。"
            elif plan.intent == "direct_answer":
                answer = await chat.complete_text(
                    "用简体中文直接回答，不要编造用户的个人履历。",
                    question,
                )
                yield _step_event("analyst", "running")
                yield _step_event("analyst", "done")
                steps_done.append({"name": "analyst", "status": "done", "durationMs": 0})
            else:
                answer = plan.brief_reply or "在的。"
        elif plan.intent in {"remember_user_fact", "recall_user_fact"}:
            yield _step_event("user_fact", "running")
            yield _step_event("user_fact", "done")
            steps_done.append({"name": "user_fact", "status": "done", "durationMs": 0})
            if plan.intent == "remember_user_fact" and plan.user_fact_key and plan.user_fact_value:
                remember_fact(
                    context.corpus_user_id,
                    plan.user_fact_key,
                    plan.user_fact_value,
                    plan.user_fact_label,
                )
                answer = f"已记住{plan.user_fact_label or plan.user_fact_key}：{plan.user_fact_value}"
            else:
                found = recall_fact(context.corpus_user_id, plan.user_fact_key or "")
                if found:
                    answer = f"{found.get('label') or plan.user_fact_key}是{found.get('value')}"
                else:
                    answer = f"还没有记住{plan.user_fact_label or plan.user_fact_key or '这项'}。"
        else:
            for step in plan.steps:
                if turns.is_cancelled(turn_id):
                    yield ("aborted", {"type": "aborted", "turnId": turn_id, "reason": "cancelled"})
                    answer = ""
                    break
                step_name = _step_name(step.kind)
                yield _step_event(step_name, "running")
                text, hits = await _run_step(step, context.corpus_user_id, chat)
                evidence.append(text)
                hit_paths.extend(hit.path for hit in hits)
                yield _step_event(step_name, "done")
                steps_done.append({"name": step_name, "status": "done", "durationMs": 0})
                executed.append(step.kind)
            if executed:
                pure_list = all(kind == "list" for kind in executed)
                tail = ("content_organizer",) if pure_list else ("plan_slot_join", "plan_merge", "content_organizer")
                for name in tail:
                    if name == "content_organizer" and plan.compose_mode == "summarize":
                        yield _step_event("content_summarizer", "running")
                        yield _step_event("content_summarizer", "done")
                        steps_done.append({"name": "content_summarizer", "status": "done", "durationMs": 0})
                    yield _step_event(name, "running")
                    yield _step_event(name, "done")
                    steps_done.append({"name": name, "status": "done", "durationMs": 0})
                yield _step_event("analyst", "running")
                answer = await chat.complete_text(
                    _ANALYST,
                    f"问题：{question}\n\n材料：\n" + "\n\n".join(evidence),
                )
                yield _step_event("analyst", "done")
                steps_done.append({"name": "analyst", "status": "done", "durationMs": 0})
            elif not answer:
                answer = plan.clarifying_question or "请把问题说得更具体一些。"
        if answer:
            yield ("assistant", {"type": "assistant", "text": answer})
            yield (
                "assistant_message",
                {
                    "type": "assistant_message",
                    "message": {"plainText": answer, "blocks": [], "citations": []},
                },
            )
    except Exception as exc:
        yield ("error", {"type": "error", "message": str(exc) or "Agent pipeline failed"})
        answer = ""
    finally:
        turns.finish(turn_id)
    timing = {"totalMs": 0, "ttftMs": None, "nodes": {}}
    yield ("pipeline_timing", {"type": "pipeline_timing", "timing": timing})
    yield (
        "pipeline_done",
        {
            "answer": answer,
            "blocks": [],
            "citations": [],
            "retrievalPaths": hit_paths,
            "timing": timing,
            "logs": [],
            "steps": steps_done,
            "aborted": False,
            "turnId": turn_id,
        },
    )


def parse_document(path: str) -> str:
    return parse_to_markdown(Path(path))
