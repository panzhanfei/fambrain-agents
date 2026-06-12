import { prisma } from "@fambrain/db";
export const resolveCorpusUserId = async (actorUserId: string): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv)
        return fromEnv;
    const user = await prisma.user.findUnique({
        where: { id: actorUserId },
        select: { corpusUserId: true },
    });
    if (user?.corpusUserId)
        return user.corpusUserId;
    return actorUserId;
};
