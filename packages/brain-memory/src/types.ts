/** Pipeline 注入的记忆上下文（Mem0 跨会话 + LangMem 会话摘要） */
export type PipelineMemoryContext = {
    /** LangMem：当前会话较早轮次的压缩摘要 */
    sessionSummary: string | null;
    /** Mem0：与本轮问题相关的用户长期记忆条目 */
    userMemories: string[];
    /** 拼进 Intake / Analyst prompt 的单块文本；无内容时为 null */
    promptBlock: string | null;
    /** 供 Intake 使用的截断历史（LangMem 启用时保留最近 N 轮） */
    intakeHistory: import("@fambrain/brain-types").DbChatTurn[];
};
