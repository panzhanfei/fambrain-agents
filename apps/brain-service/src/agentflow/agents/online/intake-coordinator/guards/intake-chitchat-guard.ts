/**
 * P0-13：`chitchat` 的 briefReply 模板兜底，禁止未定义称呼（如「大表哥」）。
 */
import type { IntakeRoutingDecision } from "../contract/prompt";

export const DEFAULT_CHITCHAT_BRIEF_REPLY =
    "你好，我是 FamBrain 助手。可以问我关于工作经历、项目或技术栈的问题。";

const FORBIDDEN_CHITCHAT_RE =
    /大表哥|表哥|老铁|宝子|亲爱的|小可爱|帅哥|美女|老板|昵称|南起|赵一|陈明/i;

export const isAcceptableChitchatBriefReply = (text: string): boolean => {
    const t = text.trim();
    if (!t)
        return false;
    if (FORBIDDEN_CHITCHAT_RE.test(t))
        return false;
    return /FamBrain|助手/.test(t);
};

export const applyIntakeChitchatGuard = (
    decision: IntakeRoutingDecision
): IntakeRoutingDecision => {
    if (decision.intent !== "chitchat")
        return decision;
    const briefReply = decision.briefReply?.trim();
    if (briefReply && isAcceptableChitchatBriefReply(briefReply))
        return {
            ...decision,
            needsRetrieval: false,
            retrievalPlan: [],
        };
    return {
        ...decision,
        needsRetrieval: false,
        retrievalPlan: [],
        briefReply: DEFAULT_CHITCHAT_BRIEF_REPLY,
    };
};
