/** 与数据库消息表对齐的对话轮次，供各 Agent 与 pipeline 使用 */
export type DbChatTurn = {
  role: "user" | "assistant" | "system";
  content: string;
};

/** Orchestrator 向 HTTP 层推送的流式事件 */
export type AgentStreamEvent =
  | { type: "step"; name: "intake" | "retrieval" | "analyst"; status: "running" | "done" }
  | { type: "thinking"; text: string }
  | { type: "assistant"; text: string }
  | { type: "error"; message: string };

export type AgentPipelineResult = {
  answer: string;
};
