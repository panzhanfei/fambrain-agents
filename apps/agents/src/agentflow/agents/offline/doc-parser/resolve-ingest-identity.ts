import { readdir } from "node:fs/promises";
import path from "node:path";
import { DOC_ROOT, DOC_USERS_DIR } from "@fambrain/corpus";

export type IngestIdentity = {
    actorUserId: string;
    corpusUserId: string;
};

const listUserIdsOnDisk = async (): Promise<string[]> => {
    const usersRoot = path.join(DOC_ROOT, DOC_USERS_DIR);
    let entries;
    try {
        entries = await readdir(usersRoot, { withFileTypes: true });
    }
    catch {
        return [];
    }
    return entries
        .filter((ent) => ent.isDirectory() && !ent.name.startsWith("."))
        .map((ent) => ent.name)
        .sort((a, b) => a.localeCompare(b));
};

/** CLI / 脚本默认语料归属：优先 .env，否则 data/doc/users 下唯一或首个目录。 */
export const resolveDefaultIngestIdentity = async (): Promise<IngestIdentity> => {
    const corpusFromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    const actorFromEnv = process.env.FAMBRAIN_ACTOR_USER_ID?.trim();
    if (corpusFromEnv) {
        return {
            corpusUserId: corpusFromEnv,
            actorUserId: actorFromEnv ?? corpusFromEnv,
        };
    }
    const ids = await listUserIdsOnDisk();
    if (ids.length === 1) {
        return { corpusUserId: ids[0], actorUserId: actorFromEnv ?? ids[0] };
    }
    if (ids.length > 1) {
        const picked = ids[0];
        console.warn(
            `检测到多个语料用户目录（${ids.join("、")}），使用 ${picked}。可在 .env 设置 FAMBRAIN_CORPUS_USER_ID 指定。`,
        );
        return { corpusUserId: picked, actorUserId: actorFromEnv ?? picked };
    }
    throw new Error(
        "未找到语料用户目录。请先在 Web 登录并导入文档，或在 .env 设置 FAMBRAIN_CORPUS_USER_ID。",
    );
};
