/** 用户自述记忆（QQ/微信/手机等）：Intake 路由解析 + LangGraph 图节点 + Mem0 读写。 */

export {
    routeUserFactFromIntake,
    parseUserFactRecord,
    serializeUserFactRecord,
    memoryBlockHasStructuredUserFacts,
    normalizeFactKey,
    validateFactValue,
    validateFactValueForKey,
    findUserFactValueInTexts,
    findUserFactValueInMemoryBlock,
    coalesceRememberValue,
    buildRememberConfirmAnswer,
    buildRememberMissingValueAnswer,
    buildRecallAnswer,
    buildRecallMissingAnswer,
    type UserFactRoute,
    type UserFactRecord,
} from "./user-fact";

export { userFactNode } from "./nodes/user-fact-node";
