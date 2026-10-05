from __future__ import annotations

import json
from typing import Protocol

import httpx
from fambrain_kernel.config import Settings
from tenacity import retry, stop_after_attempt, wait_exponential

from fambrain_agentflow.types import IntakeDecision

_INTAKE_SYSTEM = """你是 FamBrain 的入口接线员。只输出一个 JSON 对象，不要输出其它文字。
字段：
- route: "clarify" | "chitchat" | "answer"
- reply: 字符串。route 为 clarify 或 chitchat 时写下直接回复；route 为 answer 时留空。
answer 表示这个问题需要查家庭语料或工具后才能答。不要在 reply 里编造语料中的事实。
"""


class ChatCompleter(Protocol):
    async def complete_intake(self, question: str, display_name: str) -> IntakeDecision: ...

    async def complete_text(self, system: str, user: str, *, json_mode: bool = False) -> str: ...


class ScriptedChat:
    scripted = True

    def __init__(self, decision: IntakeDecision, answer: str) -> None:
        self.decision = decision
        self.answer = answer

    async def complete_intake(self, question: str, display_name: str) -> IntakeDecision:
        del question, display_name
        return self.decision

    async def complete_text(self, system: str, user: str, *, json_mode: bool = False) -> str:
        del system, user, json_mode
        return self.answer


class ClarifyChat:
    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def complete_intake(self, question: str, display_name: str) -> IntakeDecision:
        del question, display_name
        return IntakeDecision(route="clarify", reply=self.reason)

    async def complete_text(self, system: str, user: str, *, json_mode: bool = False) -> str:
        del system, user, json_mode
        return self.reason


def _loads_json(text: str) -> object:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        return {}
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return {}


class HttpChat:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def complete_intake(self, question: str, display_name: str) -> IntakeDecision:
        user = f"称呼：{display_name}\n问题：{question}"
        raw = await self._complete(_INTAKE_SYSTEM, user, json_mode=True)
        return IntakeDecision.from_payload(_loads_json(raw))

    async def complete_text(self, system: str, user: str, *, json_mode: bool = False) -> str:
        return (await self._complete(system, user, json_mode=json_mode)).strip()

    async def _complete(self, system: str, user: str, *, json_mode: bool) -> str:
        provider = self._settings.chat_provider.strip().lower()
        if provider == "openai":
            return await self._openai(system, user, json_mode=json_mode)
        return await self._ollama(system, user, json_mode=json_mode)

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=0.2, max=2), reraise=True)
    async def _openai(self, system: str, user: str, *, json_mode: bool) -> str:
        key = self._settings.resolved_openai_api_key
        if not key:
            raise RuntimeError("CHAT_PROVIDER=openai 但未配置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY")
        url = self._settings.openai_base_url.rstrip("/") + "/chat/completions"
        body: dict = {
            "model": self._settings.openai_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {key}"},
                json=body,
            )
            response.raise_for_status()
            payload = response.json()
        return str(payload["choices"][0]["message"]["content"])

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=0.2, max=2), reraise=True)
    async def _ollama(self, system: str, user: str, *, json_mode: bool) -> str:
        url = self._settings.resolved_ollama_base_url + "/api/chat"
        body: dict = {
            "model": self._settings.ollama_model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if json_mode:
            body["format"] = "json"
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(url, json=body)
            response.raise_for_status()
            payload = response.json()
        return str(payload["message"]["content"])


def build_chat(settings: Settings) -> ChatCompleter:
    provider = settings.chat_provider.strip().lower()
    if provider == "openai" and not settings.resolved_openai_api_key:
        return ClarifyChat("在线模型未配置 API key，暂时不能回答。")
    if provider not in ("openai", "ollama"):
        return ClarifyChat("CHAT_PROVIDER 只能是 ollama 或 openai。")
    return HttpChat(settings)
