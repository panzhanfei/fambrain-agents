import { AIMessage, HumanMessage, SystemMessage, type BaseMessage, } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { getAgentsConfig } from "@fambrain/agent-config";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import type { DbChatTurn } from "@fambrain/agent-types";
import { textFromResponse } from "@/agentflow/utils";
import { prompt } from "./prompt";
const { ollama } = getAgentsConfig();
const llm = new ChatOllama({
    baseUrl: ollama.baseUrl,
    model: ollama.models.intakeCoordinator,
});
const turnToMessage = (t: DbChatTurn) => {
    if (t.role === "user")
        return new HumanMessage(t.content);
    if (t.role === "assistant")
        return new AIMessage(t.content);
    return new SystemMessage(t.content);
};
export const completeIntakeCoordinator = async (history: DbChatTurn[], options?: {
    memoryBlock?: string | null;
    intakeHistory?: DbChatTurn[];
}): Promise<string> => {
    const recent = options?.intakeHistory ?? history;
    const trimmed = recent.length > 40 ? recent.slice(-40) : recent;
    const lastUser = [...trimmed].reverse().find((t) => t.role === "user")?.content ?? "";
    logAgentIn("IntakeCoordinator", "进入", {
        userQuestion: lastUser,
        turnCount: trimmed.length,
        hasMemoryBlock: Boolean(options?.memoryBlock),
    });
    const messages: BaseMessage[] = [new SystemMessage(prompt)];
    if (options?.memoryBlock) {
        messages.push(new SystemMessage(`以下为用户记忆上下文（Mem0 / LangMem），供理解指代与偏好，勿当作知识库 hits：\n\n${options.memoryBlock}`));
    }
    messages.push(...trimmed.map(turnToMessage));
    const ai = await llm.invoke(messages);
    const raw = textFromResponse(ai.content) ||
        "（模型未返回助手文本：请确认 Ollama 已启动且模型已拉取）";
    logAgentOut("IntakeCoordinator", "出去", {
        routeJsonPreview: raw.length > 800 ? `${raw.slice(0, 800)}…` : raw,
    });
    return raw;
};
