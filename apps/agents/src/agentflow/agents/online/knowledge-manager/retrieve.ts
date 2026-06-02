import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

import { getAgentsConfig } from "@fambrain/agent-config";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import { listMarkdownFiles, toRepoPath } from "@/agentflow/agents/offline/knowledge-indexer";
import { listCorpusScanRoots, SCAN_FOLDERS } from "@/agentflow/knowledge";
import { vectorRetrieve } from "./vector-retrieve";
import {
  prompt,
  type KnowledgeHit,
  type KnowledgeManagerInput,
  type KnowledgeRetrievalResult,
} from "./prompt";
import { parseJsonObject } from "@/agentflow/json-parse";
import { parseKnowledgeRetrievalResult } from "./schema";
const MAX_CANDIDATES = 12;
const MAX_HITS = 5;
const EXCERPT_MAX = 320;

const { ollama } = getAgentsConfig();

const llm = new ChatOllama({
  baseUrl: ollama.baseUrl,
  model: ollama.models.intakeCoordinator,
});

const CJK_RUN = /^[\u4e00-\u9fff]+$/;

/** 从查询句、主题等文本里拆出用于匹配的小写关键词（含中文二元切分，便于口语短问） */
function tokenize(...parts: string[]): string[] {
  const raw = parts.join(" ").toLowerCase();
  const segments = raw
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((t) => t.length >= 2);

  const expanded: string[] = [];
  for (const t of segments) {
    expanded.push(t);
    if (CJK_RUN.test(t) && t.length > 2) {
      for (let i = 0; i < t.length - 1; i++) {
        expanded.push(t.slice(i, i + 2));
      }
    }
  }
  return [...new Set(expanded)];
}

/** 从 Markdown 正文取标题：首个 `# ` 行，否则用文件名 */
function titleFromMarkdown(fileName: string, body: string): string {
  const line = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return line || fileName.replace(/\.md$/i, "");
}

/** 在正文中截取含关键词的片段，供 excerpt 使用 */
function pickExcerpt(body: string, tokens: string[]): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return text.slice(0, EXCERPT_MAX);
  const start = Math.max(0, idx - 60);
  const slice = text.slice(start, start + EXCERPT_MAX);
  return (
    (start > 0 ? "…" : "") +
    slice +
    (start + EXCERPT_MAX < text.length ? "…" : "")
  );
}

/**
 * 在 `data/doc/users/<corpusUserId>/corpus/` 下按关键词预扫候选段落（向量检索 fallback）。
 */
async function scanDocCandidates(
  corpusUserId: string,
  searchQuery: string,
  topics: string[] = [],
  subTasks: string[] = []
): Promise<KnowledgeManagerInput["candidates"]> {
  const tokens = tokenize(searchQuery, ...topics, ...subTasks);
  if (tokens.length === 0) return [];

  type Scored = KnowledgeManagerInput["candidates"][number] & { score: number };

  const scored: Scored[] = [];
  const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);

  for (const { root: corpusRoot } of scanRoots) {
    for (const folder of SCAN_FOLDERS) {
      const dir = path.join(corpusRoot, folder);
      for (const abs of await listMarkdownFiles(dir)) {
        const body = await readFile(abs, "utf8").catch(() => "");
        if (!body) continue;

        const repoPath = toRepoPath(abs);
        const haystack = `${repoPath} ${body}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (haystack.includes(t)) score += 1;
        }
        if (score === 0) continue;

        scored.push({
          path: repoPath,
          title: titleFromMarkdown(path.basename(abs), body),
          body: body.slice(0, 4000),
          score,
        });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_CANDIDATES).map(({ path, title, body }) => ({
    path,
    title,
    body,
  }));
}

function textFromResponse(content: AIMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === "string"
          ? p
          : p &&
              typeof p === "object" &&
              "text" in p &&
              typeof (p as { text: string }).text === "string"
            ? (p as { text: string }).text
            : ""
      )
      .join("")
      .trim();
  }
  return "";
}

/** 不调模型：按关键词为 candidates 打分并组装检索结果 */
function retrieveByKeywords(
  input: Pick<KnowledgeManagerInput, "searchQuery" | "topics" | "subTasks">,
  candidates: KnowledgeManagerInput["candidates"]
): KnowledgeRetrievalResult {
  const tokens = tokenize(
    input.searchQuery,
    ...input.topics,
    ...input.subTasks
  );
  if (candidates.length === 0 || tokens.length === 0) {
    return { hits: [], coverage: "none", notes: null };
  }

  const hits: KnowledgeHit[] = candidates
    .map((c) => {
      const haystack = `${c.path} ${c.title} ${c.body}`.toLowerCase();
      let matched = 0;
      for (const t of tokens) {
        if (haystack.includes(t)) matched += 1;
      }
      const relevance =
        tokens.length > 0 ? Math.min(1, matched / tokens.length) : 0;
      return {
        path: c.path,
        title: c.title,
        excerpt: pickExcerpt(c.body, tokens),
        relevance,
      };
    })
    .filter((h) => h.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, MAX_HITS);

  const top = hits[0]?.relevance ?? 0;
  const coverage = top >= 0.6 ? "sufficient" : top > 0 ? "partial" : "none";

  return {
    hits,
    coverage,
    notes:
      coverage === "partial"
        ? "仅关键词匹配；若需更准可检查 Ollama 是否可用。"
        : null,
  };
}

/** LLM 未产出有效 hits 时，回退到关键词检索结果 */
function coalesceRetrieval(
  primary: KnowledgeRetrievalResult,
  fallback: KnowledgeRetrievalResult
): KnowledgeRetrievalResult {
  if (primary.hits.length > 0) return primary;
  return fallback.hits.length > 0 ? fallback : primary;
}

/** 向量检索 检索结果 */
async function loadCandidates(input: KnowledgeManagerInput) {
  if (input.candidates.length > 0) return input.candidates;
  // 1. 先试向量
  try {
    const vectorHits = await vectorRetrieve(
      input.corpusUserId,
      [input.searchQuery, ...input.topics, ...input.subTasks].join(" ")
    );
    if (vectorHits.length > 0) return vectorHits;
  } catch (e) {
    // Chroma 不可用，静默降级
  }
  // 2. fallback 到现有关键词扫描
  return scanDocCandidates(
    input.corpusUserId,
    input.searchQuery,
    input.topics,
    input.subTasks
  );
}
/**
 * 知识检索主入口：补全 candidates → 尝试 Ollama 精排 → 失败则关键词回退。
 */
export async function retrieveKnowledge(
  input: KnowledgeManagerInput
): Promise<KnowledgeRetrievalResult> {
  logAgentIn("KnowledgeManager", "检索请求", {
    corpusUserId: input.corpusUserId,
    searchQuery: input.searchQuery,
    topics: input.topics,
    subTasks: input.subTasks,
    candidatesProvided: input.candidates.length,
  });

  const candidates = await loadCandidates(input);
  logAgentOut("KnowledgeManager", "预扫候选（摘要）", {
    corpusUserId: input.corpusUserId,
    candidateCount: candidates.length,
    paths: candidates.map((c) => c.path),
  });

  const keywordFallback = retrieveByKeywords(input, candidates);

  if (candidates.length === 0) {
    const empty = { hits: [], coverage: "none" as const, notes: null };
    logAgentOut("KnowledgeManager", "检索结果（无候选）", empty);
    return empty;
  }

  const payload: KnowledgeManagerInput = { ...input, candidates };

  try {
    const ai = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(JSON.stringify(payload, null, 2)),
    ]);
    const text = textFromResponse(ai.content);
    const parsed = parseJsonObject<KnowledgeRetrievalResult>(text);
    const result = coalesceRetrieval(
      !parsed
        ? keywordFallback
        : parseKnowledgeRetrievalResult(parsed, keywordFallback),
      keywordFallback
    );
    logAgentOut("KnowledgeManager", "检索结果", result);
    return result;
  } catch (e) {
    logAgentOut("KnowledgeManager", "检索结果（LLM 失败，关键词回退）", {
      error: e instanceof Error ? e.message : String(e),
      result: keywordFallback,
    });
    return keywordFallback;
  }
}
