#!/usr/bin/env node
/**
 * 全量语料入库 CLI：扫描 data/doc/users/ 下所有用户的 corpus，写入 Chroma。
 *
 * 用法：
 *   pnpm run index:corpus
 *   LOG_LEVEL=debug pnpm run index:corpus
 */
import { indexAllCorpora } from "@fambrain/agents";
import { bootstrapAgentsRuntime, logLangSmithStartup, } from "@/config";

const { langSmith } = bootstrapAgentsRuntime();
logLangSmithStartup(langSmith, console.log, "[index:corpus]");

indexAllCorpora()
    .then(() => process.exit(0))
    .catch((err) => {
    console.error(err);
    process.exit(1);
});
