#!/usr/bin/env node
/**
 * 全量语料入库 CLI：扫描 data/doc/users/ 下所有用户的 corpus，写入 Chroma。
 *
 * 用法：
 *   pnpm run index:corpus
 *   LOG_LEVEL=debug pnpm run index:corpus
 *
 * 依赖仓库根目录 .env（见 apps/agents/package.json 的 --env-file）
 */
import { indexAllCorpora } from "@fambrain/agents";

indexAllCorpora()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
