import { mkdir } from "node:fs/promises";
import {
    getCorpusImportDir,
    getCorpusLearnedDir,
    getUserHome,
    getVaultUploadsRoot,
    SCAN_FOLDERS,
    type CorpusCategory,
} from "@fambrain/corpus";

export const ensureCorpusUserLayout = async (corpusUserId: string, actorUserId?: string): Promise<void> => {
    await mkdir(getUserHome(corpusUserId), { recursive: true });
    await mkdir(getVaultUploadsRoot(actorUserId ?? corpusUserId), { recursive: true });
    await mkdir(getCorpusLearnedDir(corpusUserId), { recursive: true });
    for (const category of SCAN_FOLDERS) {
        await mkdir(getCorpusImportDir(corpusUserId, category as CorpusCategory), {
            recursive: true,
        });
    }
};
