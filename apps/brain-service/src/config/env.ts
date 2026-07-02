import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { getMonorepoRoot } from "./repo-root";

let rootEnvLoaded = false;

/** 根目录 `.env` 绝对路径 */
export const getRootEnvFilePath = (): string => {
    return path.join(getMonorepoRoot(), ".env");
};

/**
 * 加载仓库根 `.env`（幂等）。
 * CLI 若已用 `--env-file` 注入，重复调用不会覆盖已有 process.env。
 */
export const loadRootEnv = (): void => {
    if (rootEnvLoaded)
        return;
    loadDotenv({ path: getRootEnvFilePath() });
    rootEnvLoaded = true;
};
