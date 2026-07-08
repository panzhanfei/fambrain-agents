/**
 * P0-13：`chitchat` 固定话术由服务端注入，LLM 不撰写 briefReply（避免幻觉称呼）。
 */
import type { IntakeRoutingDecision } from "../contract/prompt";

export const DEFAULT_CHITCHAT_BRIEF_REPLY =
    "你好，我是 FamBrain 助手。可以问我关于工作经历、项目或技术栈的问题。";

/** chitchat 一律使用服务端模板，忽略 LLM 输出的 briefReply */
export const applyIntakeChitchatGuard = (
    decision: IntakeRoutingDecision
): IntakeRoutingDecision => {
    if (decision.intent !== "chitchat") {
        return decision;
    }
    return {
        ...decision,
        needsRetrieval: false,
        retrievalPlan: [],
        briefReply: DEFAULT_CHITCHAT_BRIEF_REPLY,
    };
};
