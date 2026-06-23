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
        return prisma.retrievalFeedback.update({
            where: { id: existing.id },
            data: {
                signal: input.signal,
                query: input.query,
            },
        });
    }
    return prisma.retrievalFeedback.create({ data: input });
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
