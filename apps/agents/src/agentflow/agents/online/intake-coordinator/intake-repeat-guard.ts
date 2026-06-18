/**
 * D5-2：同会话字面重复问 — 复用 history 中已有 assistant 答，跳过 Intake LLM / KM / FC / Analyst。
 * Key = normalize(userQuestion)，与 retrieval cache（searchQuery + queryType）互补。
 */
import type { DbChatTurn } from "@fambrain/agent-types";
import { normalizeSearchQuery } from "@fambrain/infra";

const assistantAfter = (
    turns: DbChatTurn[],
    userIndex: number
): string | null => {
    for (let j = userIndex + 1; j < turns.length; j++) {
        const turn = turns[j]!;
        if (turn.role === "assistant") {
            const text = turn.content.trim();
            return text.length > 0 ? turn.content : null;
        }
        if (turn.role === "user") break;
    }
    return null;
};

/**
 * 在 history（含本轮 user，末条应为当前问）中查找同 normalize 问法的最近一轮 assistant 答。
 */
export const findRepeatAnswerInHistory = (
    history: DbChatTurn[],
    userQuestion: string
): string | null => {
    const needle = normalizeSearchQuery(userQuestion);
    if (!needle) return null;

    const prior =
        history.length > 0 && history[history.length - 1]?.role === "user"
            ? history.slice(0, -1)
            : history;

    for (let i = prior.length - 1; i >= 0; i--) {
        const turn = prior[i]!;
        if (turn.role !== "user") continue;
        if (normalizeSearchQuery(turn.content) !== needle) continue;
        const answer = assistantAfter(prior, i);
        if (answer) return answer;
    }
    return null;
};
