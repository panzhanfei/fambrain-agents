import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

import { getAgentsConfig } from "@/agents/config";

import {
  prompt,
  type KnowledgeHit,
  type KnowledgeManagerInput,
  type KnowledgeRetrievalResult,
} from "./prompt";

const DOC_ROOT = path.join(process.cwd(), "src/doc");
const SCAN_FOLDERS = ["experience", "projects", "personal"] as const;
const MAX_CANDIDATES = 12;
const MAX_HITS = 5;
const EXCERPT_MAX = 320;

const { ollama } = getAgentsConfig();

const llm = new ChatOllama({
  baseUrl: ollama.baseUrl,
  model: ollama.models.intakeCoordinator,
});

/** 从查询句、主题等文本里拆出用于匹配的小写关键词 */
function tokenize(...parts: string[]): string[] {
  const raw = parts.join(" ").toLowerCase();
  const tokens = raw
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((t) => t.length >= 2);
  return [...new Set(tokens)];
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
  return (start > 0 ? "…" : "") + slice + (start + EXCERPT_MAX < text.length ? "…" : "");
}

/** 递归收集目录下所有 .md 文件路径（跳过 originals 等） */
async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const ent of entries) {
    const name = String(ent.name);
    const full = path.join(dir, name);
    if (ent.isDirectory()) {
      if (name === "originals" || name === "images") continue;
      files.push(...(await listMarkdownFiles(full)));
    } else if (ent.isFile() && name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

/** 将绝对路径转为仓库内相对路径，如 src/doc/projects/foo.md */
function toRepoPath(absPath: string): string {
  return path.relative(process.cwd(), absPath).split(path.sep).join("/");
}

/**
 * 在 src/doc 下按关键词预扫候选段落（P0 假 RAG）。
 * 编排器可先调此方法，再把结果填入 KnowledgeManagerInput.candidates。
 */
export async function scanDocCandidates(
  searchQuery: string,
  topics: string[] = [],
  subTasks: string[] = []
): Promise<KnowledgeManagerInput["candidates"]> {
  const tokens = tokenize(searchQuery, ...topics, ...subTasks);
  if (tokens.length === 0) return [];

  type Scored = KnowledgeManagerInput["candidates"][number] & { score: number };

  const scored: Scored[] = [];

  for (const folder of SCAN_FOLDERS) {
    const root = path.join(DOC_ROOT, folder);
    for (const abs of await listMarkdownFiles(root)) {
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

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_CANDIDATES).map(({ path, title, body }) => ({
    path,
    title,
    body,
  }));
}

/** 从模型回复文本里抠出 JSON 对象 */
function parseJsonObject<T>(text: string): T | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
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
  searchQuery: string,
  candidates: KnowledgeManagerInput["candidates"]
): KnowledgeRetrievalResult {
  const tokens = tokenize(searchQuery);
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
  const coverage =
    top >= 0.6 ? "sufficient" : top > 0 ? "partial" : "none";

  return {
    hits,
    coverage,
    notes:
      coverage === "partial"
        ? "仅关键词匹配；若需更准可检查 Ollama 是否可用。"
        : null,
  };
}

/** 校验并规范化模型输出的 JSON */
function normalizeResult(
  raw: unknown,
  fallback: KnowledgeRetrievalResult
): KnowledgeRetrievalResult {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.hits)) return fallback;

  const hits: KnowledgeHit[] = o.hits
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .map((h) => ({
      path: String(h.path ?? ""),
      title: String(h.title ?? ""),
      excerpt: String(h.excerpt ?? ""),
      relevance: Math.min(1, Math.max(0, Number(h.relevance) || 0)),
    }))
    .filter((h) => h.path && h.excerpt)
    .slice(0, MAX_HITS);

  const coverage =
    o.coverage === "sufficient" ||
    o.coverage === "partial" ||
    o.coverage === "none"
      ? o.coverage
      : fallback.coverage;

  const notes =
    o.notes === null || o.notes === undefined
      ? null
      : String(o.notes).trim() || null;

  return { hits, coverage, notes };
}

/**
 * 知识检索主入口：补全 candidates → 尝试 Ollama 精排 → 失败则关键词回退。
 */
export async function retrieveKnowledge(
  input: KnowledgeManagerInput
): Promise<KnowledgeRetrievalResult> {
  const candidates =
    input.candidates.length > 0
      ? input.candidates
      : await scanDocCandidates(
          input.searchQuery,
          input.topics,
          input.subTasks
        );

  const keywordFallback = retrieveByKeywords(input.searchQuery, candidates);

  if (candidates.length === 0) {
    return { hits: [], coverage: "none", notes: null };
  }

  const payload: KnowledgeManagerInput = { ...input, candidates };

  try {
    const ai = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(JSON.stringify(payload, null, 2)),
    ]);
    const text = textFromResponse(ai.content);
    const parsed = parseJsonObject<KnowledgeRetrievalResult>(text);
    if (!parsed) return keywordFallback;
    return normalizeResult(parsed, keywordFallback);
  } catch {
    return keywordFallback;
  }
}
