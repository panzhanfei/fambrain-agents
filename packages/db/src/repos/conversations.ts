import type { DbChatTurn } from "@fambrain/agent-types";
import { ChatRole } from "../generated/prisma/client";
import { prisma } from "../client";
export type MessageRow = {
    id: string;
    role: string;
    content: string;
};
export const findOwnedConversation = async (conversationId: string, userId: string) => {
    return prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, userId: true, title: true },
    }).then((c) => (c && c.userId === userId ? c : null));
};
export const listConversationMessages = async (conversationId: string): Promise<MessageRow[]> => {
    return prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true },
    });
};
export const toModelHistory = (rows: {
    role: string;
    content: string;
}[]): DbChatTurn[] => {
    return rows.map((r) => ({
        role: r.role as DbChatTurn["role"],
        content: r.content,
    }));
};
export const appendUserMessage = async (conversationId: string, content: string) => {
    return prisma.message.create({
        data: {
            conversationId,
            role: ChatRole.user,
            content,
        },
        select: { id: true, role: true, content: true },
    });
};
export const appendAssistantMessage = async (conversationId: string, content: string) => {
    return prisma.message.create({
        data: {
            conversationId,
            role: ChatRole.assistant,
            content,
        },
        select: { id: true, role: true, content: true },
    });
};
export const maybeUpdateConversationTitle = async (conversationId: string, currentTitle: string, firstUserContent: string) => {
    if (currentTitle !== "新对话")
        return;
    const messageCount = await prisma.message.count({ where: { conversationId } });
    if (messageCount !== 1)
        return;
    const t = firstUserContent.trim();
    const title = t.length <= 48 ? t || "新对话" : `${t.slice(0, 48)}…`;
    await prisma.conversation.update({
        where: { id: conversationId },
        data: { title },
    });
};

export const deleteOwnedConversation = async (conversationId: string, userId: string): Promise<boolean> => {
    const owned = await findOwnedConversation(conversationId, userId);
    if (!owned)
        return false;
    await prisma.conversation.delete({ where: { id: conversationId } });
    return true;
};
