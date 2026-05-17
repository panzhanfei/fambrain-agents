import { prisma } from "@/lib/prisma";

export type ConversationListItem = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
};

/** 侧边栏对话列表（仅当前登录用户名下的会话，与 GET /api/conversations 一致） */
export async function getSidebarConversations(userId: string): Promise<ConversationListItem[]> {
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true },
      },
    },
  });

  return conversations.map((c) => {
    const raw = c.messages[0]?.content ?? "";
    const preview = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
    return {
      id: c.id,
      title: c.title || "新对话",
      preview: preview || "",
      updatedAt: c.updatedAt.toISOString(),
    };
  });
}
