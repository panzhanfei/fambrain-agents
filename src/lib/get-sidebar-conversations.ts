import { prisma } from "@/lib/prisma";

export type ConversationListItem = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  pinned: boolean;
};

/** 侧边栏对话列表（仅当前登录用户名下的会话，与 GET /api/conversations 一致）；置顶靠前，其余按更新时间 */
export async function getSidebarConversations(userId: string): Promise<ConversationListItem[]> {
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 100,
    select: {
      id: true,
      title: true,
      pinned: true,
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
      pinned: c.pinned,
    };
  });
}
