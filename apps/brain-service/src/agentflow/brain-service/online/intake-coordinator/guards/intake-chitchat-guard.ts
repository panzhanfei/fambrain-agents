/**
 * P0-13：chitchat 固定话术 — LLM 只产 intent，briefReply 由服务端注入，避免幻觉称呼。
 */
import type { IntakeRoutingDecision } from "../contract/prompt";

export const DEFAULT_CHITCHAT_BRIEF_REPLY =
    "你好，我是 FamBrain 助手。可以问我关于工作经历、项目或技术栈的问题。";

/** intent 为 chitchat 时注入标准 briefReply（忽略 LLM 原文） */
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
