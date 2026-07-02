import type { DbChatTurn } from "@fambrain/brain-types";
import { ChatRole, type Prisma } from "../generated/prisma/client";
import { prisma } from "../client";
export type MessageRow = {
  id: string;
  role: string;
  content: string;
  metadata?: unknown;
};
export const findOwnedConversation = async (
  conversationId: string,
  userId: string
) => {
  return prisma.conversation
    .findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true, title: true },
    })
    .then((c) => (c && c.userId === userId ? c : null));
};
export const listConversationMessages = async (
  conversationId: string
): Promise<MessageRow[]> => {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, metadata: true },
  });
};
export const toModelHistory = (
  rows: {
    role: string;
    content: string;
  }[]
): DbChatTurn[] => {
  return rows.map((r) => ({
    role: r.role as DbChatTurn["role"],
    content: r.content,
  }));
};
export const appendUserMessage = async (
  conversationId: string,
  content: string
) => {
  return prisma.message.create({
    data: {
      conversationId,
      role: ChatRole.user,
      content,
    },
    select: { id: true, role: true, content: true },
  });
};
export const appendAssistantMessage = async (
  conversationId: string,
  content: string,
  metadata?: Prisma.InputJsonValue
) => {
  return prisma.message.create({
    data: {
      conversationId,
      role: ChatRole.assistant,
      content,
      metadata: metadata ?? undefined,
    },
    select: { id: true, role: true, content: true },
  });
};
const CONVERSATION_TITLE_MAX_LEN = 20;

/** 首条用户消息 → 侧边栏/顶栏标题：取第一个问句，再截断 */
export const deriveConversationTitle = (firstUserContent: string): string => {
  const trimmed = firstUserContent.trim();
  if (!trimmed) return "新对话";
  const firstPart = trimmed.split(/[？?\n;；]/)[0]?.trim() || trimmed;
  if (firstPart.length <= CONVERSATION_TITLE_MAX_LEN) return firstPart;
  return `${firstPart.slice(0, CONVERSATION_TITLE_MAX_LEN)}…`;
};

export const maybeUpdateConversationTitle = async (
  conversationId: string,
  currentTitle: string,
  firstUserContent: string
) => {
  if (currentTitle !== "新对话") return;
  const messageCount = await prisma.message.count({
    where: { conversationId },
  });
  if (messageCount !== 1) return;
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { title: deriveConversationTitle(firstUserContent) },
  });
};

export const deleteOwnedConversation = async (
  conversationId: string,
  userId: string
): Promise<boolean> => {
  const owned = await findOwnedConversation(conversationId, userId);
  if (!owned) return false;
  await prisma.conversation.delete({ where: { id: conversationId } });
  return true;
};
