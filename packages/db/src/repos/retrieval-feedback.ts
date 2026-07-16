import { prisma } from "../client";

export const upsertRetrievalFeedback = async (input: {
    userId: string;
    corpusUserId: string;
    repoPath: string;
    signal: number;
    conversationId?: string;
    messageId?: string;
    query?: string;
}) => {
    const existing = await prisma.retrievalFeedback.findFirst({
        where: {
            userId: input.userId,
            messageId: input.messageId ?? null,
            repoPath: input.repoPath,
        },
        orderBy: { createdAt: "desc" },
    });
    if (existing) {
        // 已有明确投票（±1）则锁定，不允许改票（与前端互斥置灰一致）
        if (existing.signal === 1 || existing.signal === -1) {
            return existing;
        }
        return prisma.retrievalFeedback.update({
            where: { id: existing.id },
            data: {
                signal: input.signal,
                query: input.query,
                updatedAt: new Date(),
            },
        });
    }
    return prisma.retrievalFeedback.create({
        data: {
            ...input,
            updatedAt: new Date(),
        },
    });
};

/** 某条助手消息上用户已投的反馈（同 messageId 多 path 取多数/首条非零） */
export const getMessageRetrievalFeedbackSignal = async (input: {
    userId: string;
    messageId: string;
}): Promise<-1 | 0 | 1 | null> => {
    const rows = await prisma.retrievalFeedback.findMany({
        where: {
            userId: input.userId,
            messageId: input.messageId,
        },
        select: { signal: true },
        orderBy: { updatedAt: "desc" },
        take: 20,
    });
    if (rows.length === 0) return null;
    const signal = rows[0]?.signal;
    if (signal === 1 || signal === -1 || signal === 0) return signal;
    return null;
};

export const aggregateFeedbackByPath = async (
    corpusUserId: string
): Promise<Map<string, number>> => {
    const rows = await prisma.retrievalFeedback.groupBy({
        by: ["repoPath"],
        where: { corpusUserId },
        _sum: { signal: true },
        _count: { signal: true },
    });
    const map = new Map<string, number>();
    for (const row of rows) {
        const count = row._count.signal ?? 0;
        const sum = row._sum.signal ?? 0;
        if (count > 0) {
            map.set(row.repoPath, sum / count);
        }
    }
    return map;
};
