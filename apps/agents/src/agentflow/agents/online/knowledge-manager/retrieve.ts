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
import { HumanMessage, SystemMessage, } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { getAgentsConfig } from "@fambrain/agent-config";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import { listCorpusScanRoots, listMarkdownFiles, SCAN_FOLDERS, searchCorpusVectors, toRepoPath, } from "@fambrain/corpus";
import { prompt, type KnowledgeHit, type KnowledgeManagerInput, type KnowledgeRetrievalResult, } from "./prompt";
import { parseJsonObject, textFromResponse } from "@/agentflow/utils";
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
const summarizeCandidate = (c: CandidateRow, index: number) => {
    return {
        rank: index + 1,
        path: c.path,
        title: c.title,
        bodyChars: c.body.length,
        bodyPreview: c.body.replace(/\s+/g, " ").trim().slice(0, LOG_BODY_PREVIEW),
        score: c.score,
    };
};
const summarizeCandidates = (candidates: CandidateRow[]) => {
    return candidates.map(summarizeCandidate);
};
const summarizeRetrievalOut = (result: KnowledgeRetrievalResult, extra: Record<string, unknown> = {}) => ({
    hitCount: result.hits.length,
    coverage: result.coverage,
    notes: result.notes,
    paths: result.hits.map((h) => h.path),
    hits: result.hits.map((h, i) => ({
        rank: i + 1,
        path: h.path,
        title: h.title,
        relevance: h.relevance,
        excerptPreview: h.excerpt.slice(0, LOG_BODY_PREVIEW),
    })),
    ...extra,
});
const tokenize = (...parts: string[]): string[] => {
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
};
const titleFromMarkdown = (fileName: string, body: string): string => {
    const line = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return line || fileName.replace(/\.md$/i, "");
};
const pickExcerpt = (body: string, tokens: string[]): string => {
    const text = body.replace(/\s+/g, " ").trim(); // 压空白，便于截取
    if (!text)
        return "";
    const lower = text.toLowerCase();
    let idx = -1; // 最早出现的 token 位置
    for (const t of tokens) {
        const i = lower.indexOf(t);
        if (i >= 0 && (idx < 0 || i < idx))
            idx = i; // 取最靠前的匹配
    }
    if (idx < 0)
        return text.slice(0, EXCERPT_MAX); // 无 token 命中：取开头
    const start = Math.max(0, idx - 60); // 匹配点前留上下文
    const slice = text.slice(start, start + EXCERPT_MAX);
    return ((start > 0 ? "…" : "") + // 前面被截断
        slice +
        (start + EXCERPT_MAX < text.length ? "…" : "") // 后面被截断
    );
};
const scanDocCandidates = 
/**
 * L1b：在 `data/doc/users/<corpusUserId>/corpus/` 下按关键词扫盘候选（向量检索 fallback）。
 * 扫描 experience / projects / personal 三个子目录下的所有 Markdown。
 */
async (corpusUserId: string, searchQuery: string, topics: string[] = [], subTasks: string[] = []): Promise<KnowledgeManagerInput["candidates"]> => {
    const tokens = tokenize(searchQuery, ...topics, ...subTasks);
    if (tokens.length === 0) {
        return [];
    }
    type Scored = KnowledgeManagerInput["candidates"][number] & {
        score: number;
    };
    const scored: Scored[] = [];
    const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);
    // 遍历每个语料根目录（兼容不同磁盘布局）
    for (const { root: corpusRoot } of scanRoots) {
        // experience / projects / personal 三类语料目录
        for (const folder of SCAN_FOLDERS) {
            const dir = path.join(corpusRoot, folder);
            for (const abs of await listMarkdownFiles(dir)) {
                const body = await readFile(abs, "utf8").catch(() => ""); // 读失败当空文件
                if (!body)
                    continue;
                const repoPath = toRepoPath(abs); // 绝对路径 → 仓库相对路径
                const haystack = `${repoPath} ${body}`.toLowerCase(); // 路径+正文一起做匹配
                let score = 0; // 命中 token 个数（简单计数，非 TF-IDF）
                for (const t of tokens) {
                    if (haystack.includes(t))
                        score += 1;
                }
                if (score === 0)
                    continue; // 零命中跳过
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
    // 对外只返回 path/title/body，去掉内部 score
    return top.map(({ path, title, body }) => ({
        path,
        title,
        body,
    }));
};
const retrieveByKeywords = (input: Pick<KnowledgeManagerInput, "searchQuery" | "topics" | "subTasks">, candidates: KnowledgeManagerInput["candidates"]): KnowledgeRetrievalResult => {
    const tokens = tokenize(input.searchQuery, ...input.topics, ...input.subTasks);
    if (candidates.length === 0 || tokens.length === 0) {
        const empty = { hits: [], coverage: "none" as const, notes: null };
        return empty;
    }
    const scored = candidates
        .map((c) => {
        const haystack = `${c.path} ${c.title} ${c.body}`.toLowerCase();
        let matched = 0;
        for (const t of tokens) {
            if (haystack.includes(t))
                matched += 1; // 统计命中了几个 query token
        }
        // relevance = 命中比例， capped 到 [0,1]
        const relevance = tokens.length > 0 ? Math.min(1, matched / tokens.length) : 0;
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
        notes: coverage === "partial"
            ? "仅关键词匹配；若需更准可检查 Ollama 是否可用。"
            : null,
    };
    return result;
};
const coalesceRetrieval = (primary: KnowledgeRetrievalResult, fallback: KnowledgeRetrievalResult): {
    result: KnowledgeRetrievalResult;
    chosenSource: string;
} => {
    if (primary.hits.length > 0) {
        return { result: primary, chosenSource: "llm" };
    }
    if (fallback.hits.length > 0) {
        return { result: fallback, chosenSource: "keyword_fallback" };
    }
    return { result: primary, chosenSource: "empty" };
};
const loadCandidates = 
/**
 * L1 召回总控：优先用外部 candidates → 向量 Chroma → 关键词磁盘扫盘。
 */
async (input: KnowledgeManagerInput): Promise<{
    candidates: KnowledgeManagerInput["candidates"];
    recallSource: RecallSource;
}> => {
    // 优先用外部 candidates  线上正常使用是不会进这个判断。
    if (input.candidates.length > 0) {
        return { candidates: input.candidates, recallSource: "provided" };
    }
    // 向量检索用更长的 query：主检索句 + 主题 + 子任务，增强语义召回
    const vectorQuery = [
        input.searchQuery,
        ...input.topics,
        ...input.subTasks,
    ].join(" ");
    try {
        const vectorHits = await searchCorpusVectors(input.corpusUserId, vectorQuery, MAX_CANDIDATES);
        if (vectorHits.length > 0) {
            return { candidates: vectorHits, recallSource: "vector" };
        }
    }
    catch (e) {
    }
    const scanned = await scanDocCandidates(input.corpusUserId, input.searchQuery, input.topics, input.subTasks);
    return { candidates: scanned, recallSource: "keyword_scan" };
};
export const retrieveKnowledge = async (input: KnowledgeManagerInput): Promise<KnowledgeRetrievalResult> => {
    logAgentIn("KnowledgeManager", "进入", {
        corpusUserId: input.corpusUserId,
        searchQuery: input.searchQuery,
        topics: input.topics,
        subTasks: input.subTasks,
        candidatesProvided: input.candidates.length,
    });
    const { candidates, recallSource } = await loadCandidates(input);
    const keywordFallback = retrieveByKeywords(input, candidates);
    if (candidates.length === 0) {
        const empty = { hits: [], coverage: "none" as const, notes: null };
        logAgentOut("KnowledgeManager", "出去", summarizeRetrievalOut(empty, {
            recallSource,
            resultSource: "empty",
        }));
        return empty;
    }
    // 把完整输入（含 candidates）序列化，作为 HumanMessage 发给精排模型
    const payload: KnowledgeManagerInput = { ...input, candidates };
    const payloadJson = JSON.stringify(payload, null, 2);
    try {
        // L3：SystemMessage=职责与 JSON 格式；HumanMessage=待精排的 candidates JSON
        const ai = await llm.invoke([
            new SystemMessage(prompt),
            new HumanMessage(payloadJson),
        ]);
        const text = textFromResponse(ai.content); // 模型回复 → 纯文本
        const parsed = parseJsonObject<KnowledgeRetrievalResult>(text); // 从回复中抠 JSON
        // JSON 解析失败 → 整包用 keywordFallback；成功 → Zod 校验，不合格字段回退
        const llmResult: KnowledgeRetrievalResult = !parsed
            ? keywordFallback
            : parseKnowledgeRetrievalResult(parsed, keywordFallback);
        // LLM 有 hits 优先；否则用 L2 关键词结果
        const { result, chosenSource } = coalesceRetrieval(llmResult, keywordFallback);
        logAgentOut("KnowledgeManager", "出去", summarizeRetrievalOut(result, {
            recallSource,
            resultSource: chosenSource,
            llmJsonParsed: parsed !== null,
            candidateCount: candidates.length,
        }));
        return result;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logAgentOut("KnowledgeManager", "出去", summarizeRetrievalOut(keywordFallback, {
            recallSource,
            resultSource: "keyword_fallback",
            llmError: msg,
            candidateCount: candidates.length,
        }));
        return keywordFallback;
    }
};
