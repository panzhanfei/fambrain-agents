import {
    MemoryCandidateTarget,
    PendingMemoryFactStatus,
} from "../generated/prisma/client";
import { prisma } from "../client";

export type CreatePendingMemoryFactInput = {
    userId: string;
    corpusUserId: string;
    factKey: string;
    label: string;
    value: string;
    confidence: number;
    target?: MemoryCandidateTarget;
    sourceConversationId?: string;
    sourceUserQuestion?: string;
    citations?: string[];
};

export const createPendingMemoryFact = async (input: CreatePendingMemoryFactInput) => {
    return prisma.pendingMemoryFact.create({
        data: {
            userId: input.userId,
            corpusUserId: input.corpusUserId,
            factKey: input.factKey,
            label: input.label,
            value: input.value,
            confidence: input.confidence,
            target: input.target ?? MemoryCandidateTarget.MEM0,
            sourceConversationId: input.sourceConversationId,
            sourceUserQuestion: input.sourceUserQuestion,
            citations: input.citations?.length ? input.citations : undefined,
        },
    });
};

export const listPendingMemoryFactsForUser = async (
    userId: string,
    status: PendingMemoryFactStatus = PendingMemoryFactStatus.PENDING
) => {
    return prisma.pendingMemoryFact.findMany({
        where: { userId, status },
        orderBy: { createdAt: "desc" },
    });
};

export const listAllPendingMemoryFacts = async (
    status: PendingMemoryFactStatus = PendingMemoryFactStatus.PENDING
) => {
    return prisma.pendingMemoryFact.findMany({
        where: { status },
        orderBy: { createdAt: "desc" },
        include: {
            user: {
                select: {
                    id: true,
                    username: true,
                    displayName: true,
                },
            },
        },
    });
};

export const findPendingMemoryFactForUser = async (userId: string, id: string) => {
    return prisma.pendingMemoryFact.findFirst({
        where: { id, userId },
    });
};

export const findPendingMemoryFactById = async (id: string) => {
    return prisma.pendingMemoryFact.findUnique({ where: { id } });
};

export const updatePendingMemoryFactStatus = async (input: {
    id: string;
    status: PendingMemoryFactStatus;
    reviewedByUserId?: string;
    learnedPath?: string;
    target?: MemoryCandidateTarget;
}) => {
    return prisma.pendingMemoryFact.update({
        where: { id: input.id },
        data: {
            status: input.status,
            reviewedAt: new Date(),
            reviewedByUserId: input.reviewedByUserId,
            learnedPath: input.learnedPath,
            target: input.target,
        },
    });
};
