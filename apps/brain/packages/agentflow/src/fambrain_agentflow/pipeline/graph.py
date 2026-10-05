from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from fambrain_agentflow.chat.client import ChatCompleter
from fambrain_agentflow.types import IntakeDecision

_ANALYST_SYSTEM = (
    "你是 FamBrain 的归纳回答。只用对话里已经给出的内容作答，使用简体中文。"
    "没有依据时直接说明不知道，不要编造家庭成员的事实。"
)


class GraphState(TypedDict, total=False):
    question: str
    display_name: str
    route: str
    reply: str
    answer: str


def build_pipeline(chat: ChatCompleter):
    async def intake(state: GraphState) -> dict[str, str]:
        question = state.get("question", "").strip()
        if not question:
            decision = IntakeDecision(route="clarify", reply="请把问题说得更具体一些。")
        else:
            decision = await chat.complete_intake(question, state.get("display_name", ""))
        return {"route": decision.route, "reply": decision.reply}

    async def analyst(state: GraphState) -> dict[str, str]:
        question = state.get("question", "")
        text = await chat.complete_text(_ANALYST_SYSTEM, question)
        return {"answer": text.strip() or "我还没有足够的依据来回答。"}

    def finish(state: GraphState) -> dict[str, str]:
        reply = (state.get("reply") or "").strip()
        if reply:
            return {"answer": reply}
        if state.get("route") == "chitchat":
            return {"answer": "在的。"}
        return {"answer": "请把问题说得更具体一些。"}

    def route_after_intake(state: GraphState) -> str:
        if state.get("route") == "answer":
            return "analyst"
        return "finish"

    graph = StateGraph(GraphState)
    graph.add_node("intake", intake)
    graph.add_node("analyst", analyst)
    graph.add_node("finish", finish)
    graph.add_edge(START, "intake")
    graph.add_conditional_edges(
        "intake",
        route_after_intake,
        {"analyst": "analyst", "finish": "finish"},
    )
    graph.add_edge("analyst", END)
    graph.add_edge("finish", END)
    return graph.compile()
