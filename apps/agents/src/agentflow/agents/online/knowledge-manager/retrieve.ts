/**
 * KnowledgeManager 检索实现：召回 candidates → 关键词兜底打分 → LLM 精排 → 合并输出。
 *
 * 流水线分层：
 * - L1a：Chroma 向量语义召回（优先）
 * - L1b：磁盘关键词扫盘（向量空/异常时降级）
 * - L2：内存关键词打分（不调对话模型，兼作 LLM 失败兜底）
 * - L3：Ollama 对话模型精排（只读 candidates JSON，不自行检索）
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

import { getAgentsConfig } from "@fambrain/agent-config";
import {
  logAgentIn,
  logAgentOut,
  logAgentStep,
} from "@fambrain/agent-shared/agent-log";
import {
  listMarkdownFiles,
  toRepoPath,
} from "@/agentflow/agents/offline/knowledge-indexer";
import { listCorpusScanRoots, SCAN_FOLDERS } from "@/agentflow/knowledge";
import { searchCorpusVectors } from "@/agentflow/knowledge/corpus-vector";
import {
  prompt,
  type KnowledgeHit,
  type KnowledgeManagerInput,
  type KnowledgeRetrievalResult,
} from "./prompt";
import { parseJsonObject } from "@/agentflow/utils";
import { parseKnowledgeRetrievalResult } from "./schema";

/**
 * 召回候选上限：与向量 topK 对齐。
 * - 向量层：Chroma 取语义最接近的 12 个 chunk
 * - 关键词层：扫盘打分后同样只保留 12 条交给 LLM
 * - 精排层：LLM / 关键词最终只输出 MAX_HITS=5 条
 * 12 是在「召回广度」与「LLM HumanMessage 体积/延迟」之间的 P0 折中（每条 body 最多 4000 字）。
 */
export const MAX_CANDIDATES = 12;

/** 精排后对外输出的 hits 条数上限 */
const MAX_HITS = 5;

/** L2 规则路径生成 excerpt 时的最大字符数 */
const EXCERPT_MAX = 320;

/** 日志中预览 candidate.body 的最大字符数 */
const LOG_BODY_PREVIEW = 160;

/** 日志中预览 LLM 原始回复的最大字符数（超出截断） */
const LOG_LLM_RAW_MAX = 2_000;

/** 从 agent 配置读取 Ollama 地址、模型名等 */
const { ollama } = getAgentsConfig();

/**
 * L3 精排用的对话模型实例（与 IntakeCoordinator 共用同一模型配置）。
 * 仅用于从已有 candidates 中筛选 hits，不负责召回。
 */
const llm = new ChatOllama({
  baseUrl: ollama.baseUrl,
  model: ollama.models.intakeCoordinator,
});

/** 判断一段文本是否为纯中文（用于中文二元切分） */
const CJK_RUN = /^[\u4e00-\u9fff]+$/;

/**
 * 内部候选行：标准 Candidate + 可选召回分数（向量相似度分或关键词命中数）。
 * score 不写入对外 KnowledgeManagerInput，仅用于排序与日志。
 */
type CandidateRow = KnowledgeManagerInput["candidates"][number] & {
  score?: number;
};

/**
 * 记录 L1 候选从哪条路径得来，便于日志与复盘。
 * - provided：调用方已传入 candidates，跳过 L1
 * - vector：Chroma 向量召回成功
 * - keyword_scan：向量失败/空后，磁盘关键词扫盘
 */
type RecallSource = "provided" | "vector" | "keyword_scan";

/**
 * 将单条 candidate 压缩为日志友好结构（不用于业务逻辑）。
 */
function summarizeCandidate(c: CandidateRow, index: number) {
  return {
    rank: index + 1,
    path: c.path,
    title: c.title,
    bodyChars: c.body.length,
    bodyPreview: c.body.replace(/\s+/g, " ").trim().slice(0, LOG_BODY_PREVIEW),
    score: c.score,
  };
}

/** 批量 summarizeCandidate */
function summarizeCandidates(candidates: CandidateRow[]) {
  return candidates.map(summarizeCandidate);
}

/**
 * 从查询句、主题、子任务等文本拆出用于匹配的小写关键词。
 * - 按非字母/数字/中文切分，过滤长度 < 2 的片段
 * - 纯中文长词额外做二元切分（bi-gram），便于口语短问匹配
 */
function tokenize(...parts: string[]): string[] {
  const raw = parts.join(" ").toLowerCase(); // 多段文本拼成一句并小写
  const segments = raw
    .split(/[^a-z0-9\u4e00-\u9fff]+/i) // 按标点/空格等切分
    .filter((t) => t.length >= 2); // 过短片段无区分度，丢弃

  const expanded: string[] = [];
  for (const t of segments) {
    expanded.push(t); // 保留原始词
    if (CJK_RUN.test(t) && t.length > 2) {
      // 中文长词：滑动窗口切成相邻两字，提高「口语问句」命中率
      for (let i = 0; i < t.length - 1; i++) {
        expanded.push(t.slice(i, i + 2));
      }
    }
  }
  return [...new Set(expanded)]; // 去重后返回
}

/**
 * 从 Markdown 正文提取标题：优先首个 `# ` 行，否则用文件名去掉 .md。
 * L1b 扫盘时没有向量 metadata 的 title 时使用。
 */
function titleFromMarkdown(fileName: string, body: string): string {
  const line = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return line || fileName.replace(/\.md$/i, "");
}

/**
 * 从正文中截取与查询 tokens 最相关的一小段，供 L2 规则路径的 excerpt 使用。
 * 策略：找最早出现的 token，向前留 60 字上下文，总长约 EXCERPT_MAX。
 */
function pickExcerpt(body: string, tokens: string[]): string {
  const text = body.replace(/\s+/g, " ").trim(); // 压空白，便于截取
  if (!text) return "";
  const lower = text.toLowerCase();
  let idx = -1; // 最早出现的 token 位置
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i; // 取最靠前的匹配
  }
  if (idx < 0) return text.slice(0, EXCERPT_MAX); // 无 token 命中：取开头
  const start = Math.max(0, idx - 60); // 匹配点前留上下文
  const slice = text.slice(start, start + EXCERPT_MAX);
  return (
    (start > 0 ? "…" : "") + // 前面被截断
    slice +
    (start + EXCERPT_MAX < text.length ? "…" : "") // 后面被截断
  );
}

/**
 * L1b：在 `data/doc/users/<corpusUserId>/corpus/` 下按关键词扫盘候选（向量检索 fallback）。
 * 扫描 experience / projects / personal 三个子目录下的所有 Markdown。
 */
async function scanDocCandidates(
  corpusUserId: string,
  searchQuery: string,
  topics: string[] = [],
  subTasks: string[] = []
): Promise<KnowledgeManagerInput["candidates"]> {
  const tokens = tokenize(searchQuery, ...topics, ...subTasks);

  logAgentStep("KnowledgeManager", "L1b 关键词扫盘 · 开始", {
    where:
      "磁盘 data/doc/users/<corpusUserId>/corpus/{experience,projects,personal}",
    corpusUserId,
    searchQuery,
    topics,
    subTasks,
    tokens,
    tokenCount: tokens.length,
  });

  if (tokens.length === 0) {
    logAgentStep("KnowledgeManager", "L1b 关键词扫盘 · 跳过", {
      reason: "分词结果为空，无法匹配",
    });
    return [];
  }

  type Scored = KnowledgeManagerInput["candidates"][number] & { score: number };

  const scored: Scored[] = [];
  let filesScanned = 0;
  const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);

  logAgentStep("KnowledgeManager", "L1b 关键词扫盘 · 扫描根路径", {
    scanRoots: scanRoots.map((r) => ({ root: r.root, layout: r.layout })),
    folders: [...SCAN_FOLDERS],
  });

  // 遍历每个语料根目录（兼容不同磁盘布局）
  for (const { root: corpusRoot } of scanRoots) {
    // experience / projects / personal 三类语料目录
    for (const folder of SCAN_FOLDERS) {
      const dir = path.join(corpusRoot, folder);
      for (const abs of await listMarkdownFiles(dir)) {
        filesScanned += 1;
        const body = await readFile(abs, "utf8").catch(() => ""); // 读失败当空文件
        if (!body) continue;

        const repoPath = toRepoPath(abs); // 绝对路径 → 仓库相对路径
        const haystack = `${repoPath} ${body}`.toLowerCase(); // 路径+正文一起做匹配
        let score = 0; // 命中 token 个数（简单计数，非 TF-IDF）
        for (const t of tokens) {
          if (haystack.includes(t)) score += 1;
        }
        if (score === 0) continue; // 零命中跳过

        scored.push({
          path: repoPath,
          title: titleFromMarkdown(path.basename(abs), body),
          body: body.slice(0, 4000), // 限制单文件体积，对齐 LLM 输入上限
          score,
        });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score); // 按关键词命中数降序

  const top = scored.slice(0, MAX_CANDIDATES); // 只保留前 12 条候选

  logAgentStep("KnowledgeManager", "L1b 关键词扫盘 · 完成", {
    filesScanned,
    matchedCount: scored.length,
    keptCount: top.length,
    maxCandidates: MAX_CANDIDATES,
    topScored: top.map((c, i) => ({
      rank: i + 1,
      path: c.path,
      title: c.title,
      keywordScore: c.score,
      bodyChars: c.body.length,
    })),
  });

  // 对外只返回 path/title/body，去掉内部 score
  return top.map(({ path, title, body }) => ({
    path,
    title,
    body,
  }));
}

/**
 * 将 Ollama AIMessage.content 统一提取为纯文本字符串。
 * content 可能是 string，也可能是多段 content block 数组。
 */
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

/**
 * L2：不调对话模型，对已有 candidates 做关键词 relevance 打分并组装 KnowledgeRetrievalResult。
 * 结果作为 keywordFallback，在 LLM 解析失败或 hits 为空时由 coalesceRetrieval 采用。
 */
function retrieveByKeywords(
  input: Pick<KnowledgeManagerInput, "searchQuery" | "topics" | "subTasks">,
  candidates: KnowledgeManagerInput["candidates"]
): KnowledgeRetrievalResult {
  const tokens = tokenize(
    input.searchQuery,
    ...input.topics,
    ...input.subTasks
  );

  logAgentStep("KnowledgeManager", "L2 关键词打分 · 开始", {
    where: "内存（对已有 candidates 计 relevance，不访问 Chroma/磁盘）",
    tokenCount: tokens.length,
    tokens,
    candidateCount: candidates.length,
  });

  if (candidates.length === 0 || tokens.length === 0) {
    const empty = { hits: [], coverage: "none" as const, notes: null };
    logAgentStep("KnowledgeManager", "L2 关键词打分 · 空结果", {
      reason: candidates.length === 0 ? "无 candidates" : "无 tokens",
      result: empty,
    });
    return empty;
  }

  const scored = candidates
    .map((c) => {
      const haystack = `${c.path} ${c.title} ${c.body}`.toLowerCase();
      let matched = 0;
      for (const t of tokens) {
        if (haystack.includes(t)) matched += 1; // 统计命中了几个 query token
      }
      // relevance = 命中比例， capped 到 [0,1]
      const relevance =
        tokens.length > 0 ? Math.min(1, matched / tokens.length) : 0;
      return {
        path: c.path,
        title: c.title,
        excerpt: pickExcerpt(c.body, tokens), // 规则生成摘录
        relevance,
        matchedTokens: matched, // 仅日志用
        totalTokens: tokens.length, // 仅日志用
      };
    })
    .filter((h) => h.relevance > 0) // 完全无关的 candidate 丢弃
    .sort((a, b) => b.relevance - a.relevance);

  const hits: KnowledgeHit[] = scored
    .slice(0, MAX_HITS)
    .map(({ path, title, excerpt, relevance }) => ({
      path,
      title,
      excerpt,
      relevance,
    })); // 去掉内部 matched 字段，变成对外 Hit 形态

  const top = hits[0]?.relevance ?? 0; // 最高分 hit 的 relevance
  // 用最高分推断整体证据覆盖度（规则阈值，非 LLM 判断）
  const coverage = top >= 0.6 ? "sufficient" : top > 0 ? "partial" : "none";

  const result: KnowledgeRetrievalResult = {
    hits,
    coverage,
    notes:
      coverage === "partial"
        ? "仅关键词匹配；若需更准可检查 Ollama 是否可用。"
        : null,
  };

  logAgentStep("KnowledgeManager", "L2 关键词打分 · 完成", {
    maxHits: MAX_HITS,
    coverageRule: "top≥0.6→sufficient; >0→partial; else→none",
    topRelevance: top,
    scoredPreview: scored.slice(0, MAX_CANDIDATES).map((h, i) => ({
      rank: i + 1,
      path: h.path,
      relevance: h.relevance,
      matchedTokens: h.matchedTokens,
      excerptPreview: h.excerpt.slice(0, LOG_BODY_PREVIEW),
    })),
    result,
  });

  return result;
}

/**
 * 合并 LLM 精排结果（primary）与关键词兜底结果（fallback）。
 * 策略：LLM hits 非空优先；否则用 keywordFallback；都空则返回 primary（空结果）。
 */
function coalesceRetrieval(
  primary: KnowledgeRetrievalResult,
  fallback: KnowledgeRetrievalResult,
  meta: { llmParsed: boolean }
): { result: KnowledgeRetrievalResult; chosenSource: string } {
  let result: KnowledgeRetrievalResult;
  let chosenSource: string;
  let reason: string;

  if (primary.hits.length > 0) {
    result = primary;
    chosenSource = "llm";
    reason = "采用 LLM 精排结果（primary.hits 非空）";
  } else if (fallback.hits.length > 0) {
    result = fallback;
    chosenSource = "keyword_fallback";
    reason = "LLM 无有效 hits，回退 keywordFallback";
  } else {
    result = primary;
    chosenSource = "empty";
    reason = "LLM 与 keywordFallback 均无 hits";
  }

  logAgentStep("KnowledgeManager", "⑤ 合并结果 coalesceRetrieval", {
    reason,
    llmParsed: meta.llmParsed,
    primaryHitCount: primary.hits.length,
    fallbackHitCount: fallback.hits.length,
    chosenSource,
    chosenCoverage: result.coverage,
  });

  return { result, chosenSource };
}

/**
 * L1 召回总控：优先用外部 candidates → 向量 Chroma → 关键词磁盘扫盘。
 */
async function loadCandidates(input: KnowledgeManagerInput): Promise<{
  candidates: KnowledgeManagerInput["candidates"];
  recallSource: RecallSource;
}> {
  // 优先用外部 candidates  线上正常使用是不会进这个判断。
  if (input.candidates.length > 0) {
    logAgentStep("KnowledgeManager", "L1 召回 · 使用外部 candidates", {
      recallSource: "provided",
      count: input.candidates.length,
      items: summarizeCandidates(input.candidates),
    });
    return { candidates: input.candidates, recallSource: "provided" };
  }

  // 向量检索用更长的 query：主检索句 + 主题 + 子任务，增强语义召回
  const vectorQuery = [
    input.searchQuery,
    ...input.topics,
    ...input.subTasks,
  ].join(" ");

  logAgentStep("KnowledgeManager", "L1a 向量召回 · 开始", {
    where: "Chroma collection fambrain_corpus_<corpusUserId>",
    corpusUserId: input.corpusUserId,
    vectorQuery,
    topK: MAX_CANDIDATES,
  });

  try {
    const vectorHits = await searchCorpusVectors(
      input.corpusUserId,
      vectorQuery,
      MAX_CANDIDATES
    );

    if (vectorHits.length > 0) {
      logAgentStep("KnowledgeManager", "L1a 向量召回 · 命中", {
        recallSource: "vector",
        hitCount: vectorHits.length,
        items: vectorHits.map((h, i) => ({
          rank: i + 1,
          path: h.path,
          title: h.title,
          vectorScore: h.score,
          bodyChars: h.body.length,
          bodyPreview: h.body
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, LOG_BODY_PREVIEW),
        })),
      });
      return { candidates: vectorHits, recallSource: "vector" };
    }

    logAgentStep("KnowledgeManager", "L1a 向量召回 · 无结果", {
      reason: "similaritySearchWithScore 返回空数组，降级 L1b 关键词扫盘",
    });
  } catch (e) {
    logAgentStep("KnowledgeManager", "L1a 向量召回 · 异常（静默降级）", {
      error: e instanceof Error ? e.message : String(e),
      next: "L1b 关键词扫盘",
    });
  }

  const scanned = await scanDocCandidates(
    input.corpusUserId,
    input.searchQuery,
    input.topics,
    input.subTasks
  );

  return { candidates: scanned, recallSource: "keyword_scan" };
}

/**
 * 知识检索主入口（Pipeline retrieval 节点调用）。
 * 流程：L1 召回 candidates → L2 关键词兜底 → L3 LLM 精排 → coalesce 合并 → 返回 KnowledgeRetrievalResult。
 */
export async function retrieveKnowledge(
  input: KnowledgeManagerInput
): Promise<KnowledgeRetrievalResult> {
  logAgentIn("KnowledgeManager", "① 检索请求（入口）", {
    corpusUserId: input.corpusUserId,
    searchQuery: input.searchQuery,
    topics: input.topics,
    subTasks: input.subTasks,
    candidatesProvided: input.candidates.length,
    limits: { maxCandidates: MAX_CANDIDATES, maxHits: MAX_HITS },
    pipeline: [
      "L1a 向量召回(Chroma)",
      "L1b 关键词扫盘(磁盘, 向量失败/空时)",
      "L2 关键词打分(内存, 作 LLM 兜底)",
      "L3 LLM 精排(仅读 candidates JSON)",
    ],
  });

  // L1：补全 candidates（向量或扫盘或外部传入）
  const { candidates, recallSource } = await loadCandidates(input);

  logAgentStep("KnowledgeManager", "② 召回汇总", {
    recallSource,
    candidateCount: candidates.length,
    candidates: summarizeCandidates(candidates),
  });

  // L2：提前算好关键词兜底结果，LLM 成败都有一份退路
  const keywordFallback = retrieveByKeywords(input, candidates);

  if (candidates.length === 0) {
    const empty = { hits: [], coverage: "none" as const, notes: null };
    logAgentOut("KnowledgeManager", "⑥ 检索结果（无候选，提前结束）", {
      recallSource,
      result: empty,
    });
    return empty;
  }

  // 把完整输入（含 candidates）序列化，作为 HumanMessage 发给精排模型
  const payload: KnowledgeManagerInput = { ...input, candidates };
  const payloadJson = JSON.stringify(payload, null, 2);

  logAgentStep("KnowledgeManager", "③ LLM 精排 · 请求", {
    where: "Ollama ChatOllama.invoke（不检索，只读 candidates）",
    model: ollama.models.intakeCoordinator,
    candidateCount: candidates.length,
    payloadChars: payloadJson.length,
    payloadPreview: {
      corpusUserId: payload.corpusUserId,
      searchQuery: payload.searchQuery,
      topics: payload.topics,
      subTasks: payload.subTasks,
      candidatePaths: candidates.map((c) => c.path),
    },
  });

  try {
    // L3：SystemMessage=职责与 JSON 格式；HumanMessage=待精排的 candidates JSON
    const ai = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(payloadJson),
    ]);

    const text = textFromResponse(ai.content); // 模型回复 → 纯文本

    logAgentStep("KnowledgeManager", "③ LLM 精排 · 原始回复", {
      rawChars: text.length,
      rawPreview:
        text.length > LOG_LLM_RAW_MAX
          ? `${text.slice(0, LOG_LLM_RAW_MAX)}…（已截断）`
          : text,
    });

    const parsed = parseJsonObject<KnowledgeRetrievalResult>(text); // 从回复中抠 JSON

    logAgentStep("KnowledgeManager", "④ JSON 解析 parseJsonObject", {
      success: parsed !== null,
      parsedPreview: parsed,
    });

    // JSON 解析失败 → 整包用 keywordFallback；成功 → Zod 校验，不合格字段回退
    const llmResult: KnowledgeRetrievalResult = !parsed
      ? keywordFallback
      : parseKnowledgeRetrievalResult(parsed, keywordFallback);

    logAgentStep("KnowledgeManager", "④ Zod 校验后 LLM 结果", {
      jsonParseOk: parsed !== null,
      hitCount: llmResult.hits.length,
      coverage: llmResult.coverage,
      notes: llmResult.notes,
      hits: llmResult.hits.map((h, i) => ({
        rank: i + 1,
        path: h.path,
        relevance: h.relevance,
        excerptPreview: h.excerpt.slice(0, LOG_BODY_PREVIEW),
      })),
    });

    // LLM 有 hits 优先；否则用 L2 关键词结果
    const { result, chosenSource } = coalesceRetrieval(
      llmResult,
      keywordFallback,
      {
        llmParsed: parsed !== null,
      }
    );

    logAgentOut("KnowledgeManager", "⑥ 检索结果（最终输出）", {
      recallSource,
      resultSource: chosenSource,
      result,
    });

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logAgentOut("KnowledgeManager", "⑥ 检索结果（LLM 异常，关键词兜底）", {
      recallSource,
      error: msg,
      result: keywordFallback,
    });
    return keywordFallback;
  }
}
