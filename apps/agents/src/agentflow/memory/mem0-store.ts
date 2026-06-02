import { mkdir } from "node:fs/promises";
import path from "node:path";

import { Memory } from "mem0ai/oss";

import { getMemoryConfig } from "./config";

type Mem0SearchHit = {
  memory?: string;
  text?: string;
};

let client: Memory | null = null;

async function ensureClient(): Promise<Memory | null> {
  const cfg = getMemoryConfig();
  if (!cfg.mem0Enabled) return null;

  if (!client) {
    await mkdir(path.dirname(cfg.mem0HistoryDbPath), { recursive: true });
    client = new Memory({
      llm: {
        provider: "ollama",
        config: {
          model: cfg.ollamaChatModel,
          url: cfg.ollamaBaseUrl,
        },
      },
      embedder: {
        provider: "ollama",
        config: {
          model: cfg.ollamaEmbedModel,
          url: cfg.ollamaBaseUrl,
          embeddingDims: 768,
        },
      },
      vectorStore: {
        provider: "memory",
        config: {
          collectionName: "fambrain_user_memories",
          dimension: 768,
        },
      },
      historyDbPath: cfg.mem0HistoryDbPath,
    });
  }

  return client;
}

function extractMemoryTexts(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as { results?: Mem0SearchHit[]; memories?: Mem0SearchHit[] };
  const rows = root.results ?? root.memories ?? [];
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      const text = row.memory ?? row.text;
      return typeof text === "string" ? text.trim() : "";
    })
    .filter((s) => s.length > 0);
}

/** 检索与 query 相关的用户长期记忆 */
export async function searchUserMemories(
  userId: string,
  query: string
): Promise<string[]> {
  const memory = await ensureClient();
  if (!memory) return [];

  try {
    const raw = await memory.search(query, {
      userId,
      limit: getMemoryConfig().mem0SearchLimit,
    });
    return extractMemoryTexts(raw);
  } catch (e) {
    console.warn(
      "[Mem0] search failed:",
      e instanceof Error ? e.message : String(e)
    );
    return [];
  }
}

/** 从本轮对话提取并写入 Mem0（infer 由 Mem0 内部 LLM 完成） */
export async function addTurnToMem0(
  userId: string,
  userQuestion: string,
  assistantAnswer: string
): Promise<void> {
  const memory = await ensureClient();
  if (!memory) return;

  try {
    await memory.add(
      [
        { role: "user", content: userQuestion },
        { role: "assistant", content: assistantAnswer },
      ],
      { userId, metadata: { source: "fambrain_pipeline" } }
    );
  } catch (e) {
    console.warn(
      "[Mem0] add failed:",
      e instanceof Error ? e.message : String(e)
    );
  }
}
