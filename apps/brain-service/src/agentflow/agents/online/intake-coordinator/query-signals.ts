/**
 * 问句结构工具（无问法词表 / 无意图 regex）。
 * 意图与 queryType 由 Intake LLM JSON 决定；此处只做编号、分句、去重、history 长度等结构判断。
 */
import type { DbChatTurn } from "@fambrain/brain-types";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import { looksLikeMultiPartQuestion } from "@/agentflow/agents/online/intake-coordinator/composite";

/** Intake decision 是否已声明 external_link（信 LLM，不在 guard 里猜意图） */
export const decisionRequestsExternalLink = (
    decision: IntakeRoutingDecision
): boolean => {
    if (decision.queryType === "external_link") return true;
    return (decision.retrievalPlan ?? []).some(
        (p) => p.queryType === "external_link"
    );
};

export const stripEnumerationPrefix = (segment: string): string =>
    segment.replace(/^\d+[.．、)\]】\s]+/, "").trim();

const normalizeLabelKey = (segment: string): string =>
    stripEnumerationPrefix(segment).toLowerCase().replace(/\s+/g, "");

/** 子问 label 去重（前缀包含关系，不剥离业务词） */
export const dedupePlanLabels = (units: string[]): string[] => {
    const labels = units
        .map(stripEnumerationPrefix)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);
    const out: string[] = [];
    for (const label of labels) {
        const key = normalizeLabelKey(label);
        const dupIdx = out.findIndex((existing) => {
            const ek = normalizeLabelKey(existing);
            return ek.includes(key) || key.includes(ek);
        });
        if (dupIdx >= 0) {
            if (label.length > out[dupIdx]!.length) {
                out[dupIdx] = label;
            }
            continue;
        }
        out.push(label);
    }
    return out;
};

/** 以 `1.` / `2.` 开头的行数 */
export const countNumberedLines = (question: string): number =>
    question
        .split(/\n+/)
        .map((l) => l.trim())
        .filter((l) => /^\d+[.．、]\s*/.test(l)).length;

/** 提取编号行中的子问 label（≥2 行时） */
export const extractNumberedPlanUnits = (userQuestion: string): string[] => {
    const lines = userQuestion
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
    const numberedLines = lines.filter((l) => /^\d+[.．、]\s*/.test(l));
    if (numberedLines.length < 2) return [];
    return dedupePlanLabels(
        numberedLines.map((l) =>
            stripEnumerationPrefix(l.replace(/^\d+[.．、]\s*/, ""))
        )
    );
};

/** 当前问句是否带显式多问结构（编号或多问号/并列，与 composite 一致） */
export const hasExplicitMultipartStructure = (userQuestion: string): boolean => {
    const q = userQuestion.trim();
    if (!q) return false;
    if (countNumberedLines(q) >= 2) return true;
    if (looksLikeMultiPartQuestion(q) && extractNumberedPlanUnits(q).length >= 2) {
        return true;
    }
    return looksLikeMultiPartQuestion(q) && (q.match(/[？?]/g)?.length ?? 0) >= 2;
};

/** 极短续问（结构：短句、无编号多问） */
export const isShortContinuationUtterance = (userQuestion: string): boolean => {
    const t = userQuestion.trim();
    if (!t || t.length > 32) return false;
    if (countNumberedLines(t) >= 2) return false;
    if ((t.match(/[？?]/g)?.length ?? 0) >= 2) return false;
    return true;
};

const recentTurnText = (history: DbChatTurn[], maxTurns = 6): string =>
    history
        .slice(-maxTurns)
        .map((t) => t.content.trim())
        .filter(Boolean)
        .join("\n");

export const historySupportsContinuation = (history: DbChatTurn[]): boolean =>
    recentTurnText(history).length >= 16;

/** 会话片段是否已出现 URL（结构字符，非词表） */
export const historyContainsUrl = (history: DbChatTurn[]): boolean =>
    history.some((t) => /https?:\/\//.test(t.content));

/**
 * 取「当前问句之前」最近一条实质用户问。
 * 勿用 isShortContinuationUtterance 过滤上文：正常问「城管平台用了什么技术」也可能 ≤32 字。
 */
export const lastSubstantiveUserQuestion = (
    history: DbChatTurn[],
    currentQuestion?: string
): string | null => {
    const current = currentQuestion?.trim() ?? "";
    let skippedCurrent = !current;
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const turn = history[i];
        if (turn?.role !== "user") continue;
        const q = turn.content.trim();
        if (!q || q.length < 4) continue;
        if (!skippedCurrent && q === current) {
            skippedCurrent = true;
            continue;
        }
        return q;
    }
    return null;
};

/**
 * LLM 给了多槽 plan/subTasks，但当前问句没有多问结构 → 视为过期 plan，应收束为单槽。
 */
export const hasStaleMultipartFromDecision = (
    decision: IntakeRoutingDecision,
    userQuestion: string
): boolean => {
    if (hasExplicitMultipartStructure(userQuestion)) return false;
    const planN = decision.retrievalPlan?.length ?? 0;
    const subN = decision.subTasks.length;
    return planN >= 2 || subN >= 2;
};
