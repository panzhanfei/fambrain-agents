import type { AgentPipelineContext, DbChatTurn } from "@fambrain/agent-types";
import { encodeSseEvent, sseResponse } from "@/lib/chat/sse";
import {
  appendAssistantMessage,
  appendUserMessage,
  maybeUpdateConversationTitle,
} from "@fambrain/db";

import { streamAgentPipeline } from "./agents-client";

type UiRole = "user" | "assistant";

function mapRole(role: string): UiRole {
  return role === "user" ? "user" : "assistant";
}

function streamEventName(ev: { type: string }): string {
  return ev.type;
}

/**
 * 保存用户消息后，跑 Agent 流式编排并以 SSE 返回；结束后只落库 assistant 终稿。
 */
export function createPostMessageStreamResponse(options: {
  conversationId: string;
  userContent: string;
  conversationTitle: string;
  history: DbChatTurn[];
  pipelineContext: AgentPipelineContext;
  authToken: string;
}): Response {
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        controller.enqueue(encodeSseEvent(event, payload));
      };

      let userRow: Awaited<ReturnType<typeof appendUserMessage>>;

      try {
        userRow = await appendUserMessage(
          options.conversationId,
          options.userContent
        );

        await maybeUpdateConversationTitle(
          options.conversationId,
          options.conversationTitle,
          options.userContent
        );

        send("meta", {
          userMessage: {
            id: userRow.id,
            role: mapRole(userRow.role),
            content: userRow.content,
          },
        });

        const historyWithUser: DbChatTurn[] = [
          ...options.history,
          { role: "user", content: options.userContent },
        ];

        const gen = streamAgentPipeline(
          historyWithUser,
          options.pipelineContext,
          options.authToken
        );
        let pipelineResult: { answer: string } | undefined;

        while (true) {
          const next = await gen.next();
          if (next.done) {
            pipelineResult = next.value;
            break;
          }
          const ev = next.value;
          send(streamEventName(ev), ev);
        }

        const finalContent =
          pipelineResult?.answer?.trim() ||
          "（模型未返回助手文本：请确认 Ollama 已启动且模型已拉取）";

        const assistantRow = await appendAssistantMessage(
          options.conversationId,
          finalContent
        );

        send("done", {
          userMessage: {
            id: userRow.id,
            role: mapRole(userRow.role),
            content: userRow.content,
          },
          assistantMessage: {
            id: assistantRow.id,
            role: mapRole(assistantRow.role),
            content: assistantRow.content,
          },
        });
      } catch (e) {
        console.error(e);
        const msg =
          e instanceof Error ? e.message : "模型流式调用失败，请确认本地 Ollama 可用";
        try {
          send("error", { error: msg });
        } catch {
          //
        }
      } finally {
        try {
          controller.close();
        } catch {
          //
        }
      }
    },
  });

  return sseResponse(readable);
}
