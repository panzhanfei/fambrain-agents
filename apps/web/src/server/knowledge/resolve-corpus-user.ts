import { prisma } from "@fambrain/db";

/**
 * 解析本次 RAG 检索的语料归属 userId（扫描 users/id/corpus/，非身份证号）。
 * 私人原件在 users/actorUserId/vault/，不由本函数决定。
 * 优先级：环境变量 `FAMBRAIN_CORPUS_USER_ID` → 用户表 `corpusUserId` → 当前登录 `actorUserId`。
 */
export async function resolveCorpusUserId(actorUserId: string): Promise<string> {
  const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
  if (fromEnv) return fromEnv;

  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { corpusUserId: true },
  });

  if (user?.corpusUserId) return user.corpusUserId;
  return actorUserId;
}
