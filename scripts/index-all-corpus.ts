#!/usr/bin/env node
/**
 * 全量语料入库 CLI：扫描 src/doc/users/ 下所有用户的 corpus，写入 Chroma。
 *
 * 用法：
 *   pnpm run index:corpus
 *   LOG_LEVEL=debug pnpm run index:corpus
 *
 * 依赖 .env：OLLAMA_BASE_URL、OLLAMA_MODEL_EMBED（见 .env.example）
 */
import "dotenv/config";

import { indexAllCorpora } from "@/agents/KnowledgeIndexer";

indexAllCorpora()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
