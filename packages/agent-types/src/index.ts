/** 与数据库消息表对齐的对话轮次，供各 Agent 与 pipeline 使用 */
export type DbChatTurn = {
  role: "user" | "assistant" | "system";
  content: string;
};

/** 编排上下文：由 HTTP 层注入，Agent 不直接读 session */
export type AgentPipelineContext = {
  /** 当前登录用户 */
  actorUserId: string;
  /** 本次检索 `data/doc/users/<corpusUserId>/corpus/` 使用的语料归属用户 */
  corpusUserId: string;
  displayName: string;
};

/** Orchestrator 向 HTTP 层推送的流式事件 */
export type AgentStreamEvent =
  | {
      type: "step";
      name:
        | "intake"
        | "retrieval"
        | "fact_checker"
        | "content_organizer"
        | "analyst";
      status: "running" | "done";
    }
  | { type: "thinking"; text: string }
  | { type: "assistant"; text: string }
  | { type: "error"; message: string };

export type AgentPipelineResult = {
  answer: string;
};
