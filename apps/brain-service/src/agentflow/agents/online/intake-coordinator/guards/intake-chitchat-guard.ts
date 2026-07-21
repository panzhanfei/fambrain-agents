/**
 * P0-13：chitchat 固定话术 — LLM 只产 intent，briefReply 由服务端注入，避免幻觉称呼。
 */
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import { isPureSocialUtterance } from "@/agentflow/agents/online/intake-coordinator/signals";

export const DEFAULT_CHITCHAT_BRIEF_REPLY =
    "你好，我是 FamBrain 助手。可以问我关于工作经历、项目或技术栈的问题。";

/** 单字/残缺输入短路话术（非问候模板） */
export const INCOMPLETE_UTTERANCE_BRIEF_REPLY =
    "请补充完整的问题，例如想了解哪段经历、哪个项目或什么技术。";

/** 服务端构造的标准 chitchat 决策（briefReply 由 guard 注入） */
export const buildPureChitchatDecision = (): IntakeRoutingDecision => ({
    intent: "chitchat",
    searchQuery: "",
    subTasks: [],
    topics: [],
    language: "zh",
    confidence: 1,
    queryType: null,
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [],
    userFactKey: null,
    userFactLabel: null,
    userFactValue: null,
});

/** 单字残缺问句 → chitchat 早退（不调 Intake LLM） */
export const buildIncompleteUtteranceDecision = (): IntakeRoutingDecision => ({
    ...buildPureChitchatDecision(),
    briefReply: INCOMPLETE_UTTERANCE_BRIEF_REPLY,
});

/** intent 为 chitchat 时注入标准 briefReply（忽略 LLM 原文，防幻觉称呼） */
export const applyIntakeChitchatGuard = (
    decision: IntakeRoutingDecision
): IntakeRoutingDecision => {
    if (decision.intent !== "chitchat")
        return decision;
    return {
        ...decision,
        retrievalPlan: [],
        briefReply: DEFAULT_CHITCHAT_BRIEF_REPLY,
    };
};

/**
 * 纯问候/感谢句强制 chitchat（覆盖 LLM 误判 retrieve）。
 * remember/recall 等显式 userFact intent 不覆盖。
 * 生产入口：`intake-node` 用 `isPureSocialUtterance` 跳过 LLM；本函数供 verify / 兜底导出。
 */
export const applyPureSocialUtteranceGuard = (
    decision: IntakeRoutingDecision,
    userQuestion: string
): IntakeRoutingDecision => {
    if (!isPureSocialUtterance(userQuestion)) return decision;
    if (
        decision.intent === "remember_user_fact" ||
        decision.intent === "recall_user_fact"
    ) {
        return decision;
    }
    return applyIntakeChitchatGuard({
        ...buildPureChitchatDecision(),
        language: decision.language ?? "zh",
    });
};
