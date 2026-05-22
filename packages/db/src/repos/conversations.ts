import type { DbChatTurn } from "@fambrain/agent-types";

import { ChatRole } from "../generated/prisma/client";
import { prisma } from "../client";

export type MessageRow = {
  id: string;
  role: string;
  content: string;
};

/** 校验会话归属，不存在或不属于用户则返回 null */
export async function findOwnedConversation(
  conversationId: string,
  userId: string
) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, userId: true, title: true },
  }).then((c) => (c && c.userId === userId ? c : null));
}

/** 按时间正序拉取会话消息（供 Agent 与 GET 接口） */
export async function listConversationMessages(
  conversationId: string
): Promise<MessageRow[]> {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
  });
}

export function toModelHistory(rows: { role: string; content: string }[]): DbChatTurn[] {
  return rows.map((r) => ({
    role: r.role as DbChatTurn["role"],
    content: r.content,
  }));
}

/** 追加用户消息 */
export async function appendUserMessage(conversationId: string, content: string) {
  return prisma.message.create({
    data: {
      conversationId,
      role: ChatRole.user,
      content,
    },
    select: { id: true, role: true, content: true },
  });
}

/** 追加助手终稿（pipeline 完成后唯一写入的模型输出） */
export async function appendAssistantMessage(
  conversationId: string,
  content: string
) {
  return prisma.message.create({
    data: {
      conversationId,
      role: ChatRole.assistant,
      content,
    },
    select: { id: true, role: true, content: true },
  });
}

/** 首条用户消息时更新会话标题 */
export async function maybeUpdateConversationTitle(
  conversationId: string,
  currentTitle: string,
  firstUserContent: string
) {
  if (currentTitle !== "新对话") return;
  const messageCount = await prisma.message.count({ where: { conversationId } });
  if (messageCount !== 1) return;
  const t = firstUserContent.trim();
  const title = t.length <= 48 ? t || "新对话" : `${t.slice(0, 48)}…`;
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { title },
  });
}
