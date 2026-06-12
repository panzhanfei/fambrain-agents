import { prisma } from "../client";
export type ConversationListItem = {
    id: string;
    title: string;
    preview: string;
    updatedAt: string;
    pinned: boolean;
};
export const getSidebarConversations = async (userId: string): Promise<ConversationListItem[]> => {
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
        const normalized = raw.replace(/\s+/g, " ").trim();
        const preview = normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized;
        return {
            id: c.id,
            title: c.title || "新对话",
            preview: preview || "",
            updatedAt: c.updatedAt.toISOString(),
            pinned: c.pinned,
        };
    });
};
