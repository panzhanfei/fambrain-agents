/**
 * KnowledgeManager 检索参数（KM-04 集中配置）。
 * 后续 path 加权、queryProfile 分档等亦在此扩展。
 */
import type { QueryProfile } from "./query-profile";

/** 默认 vector topK / maxHits（profile 未命中时的兜底，等同 default）。 */
export const MAX_CANDIDATES = 12;

/** 默认最终 hits 上限（等同 default profile）。 */
export const MAX_HITS = 5;

/** KM-09：各 queryProfile 的向量 topK 与 maxHits。 */
export const PROFILE_VECTOR_TOP_K = {
    identity: 12,
    enumeration: 24,
    tech: 16,
    default: 12,
} as const;

export const PROFILE_MAX_HITS = {
    identity: 4,
    enumeration: 8,
    tech: 6,
    default: 5,
} as const;

/** 单条 hit 的 excerpt 最大字符数。用于：pickExcerpt、ensureNonEmptyHits 截断。 */
export const EXCERPT_MAX = 320;

/** agent-log 📤 里 body / excerpt 预览长度。用于：summarizeCandidate、summarizeRetrievalOut。 */
export const LOG_BODY_PREVIEW = 160;

/** 读盘时单文件 body 上限（personal/experience 补注入、sparse 扫盘）。 */
export const SCAN_BODY_MAX = 4000;

/**
 * 向量召回后，同一 path 最多保留几个 chunk（L2 最优）。
 * 用于：dedupeVectorByPath（KM-02）。
 */
export const MAX_CHUNKS_PER_PATH = 2;

/**
 * 同 path 多 chunk 合并 body 的上限字符数。
 * 用于：dedupeVectorByPath（KM-02）；KM-16 与合并逻辑共用。
 */
export const MERGED_CHUNK_BODY_MAX = 6000;

/** HY-06：融合前向量 raw topK 倍数（dedupe 后再截断）。 */
export const VECTOR_FETCH_MULTIPLIER = 2;

/** HY-03：RRF 平滑常数 k。 */
export const RRF_K = 60;

/**
 * Chroma L2 距离：越小越相似。
 * HY-04 前用于 isVectorConfident；Hybrid 主路径不再串行 gating。
 */
export const VECTOR_CONFIDENT_TOP1_MAX = 1.25;

/**
 * top1 与 top2 的 L2 距离差 ≥ 此值视为「无歧义」。
 * 与 TOP1_MAX 一起决定是否仅走向量候选。用于：isVectorConfident。
 */
export const VECTOR_CONFIDENT_GAP_MIN = 0.12;

/** path 位于 corpus/personal/ 时的信誉加分（KM-03）。用于：getPathBoost、computeRelevance。 */
export const PATH_BOOST_PERSONAL = 0.25;

/** path 位于 corpus/experience/ 时的加分。用于：getPathBoost。 */
export const PATH_BOOST_EXPERIENCE = 0.1;

/** path 位于 corpus/projects/ 时的基准分（不加不减）。用于：getPathBoost。 */
export const PATH_BOOST_PROJECTS = 0;

/**
 * 项目目录下的 resume 模板 md 减分，避免与 personal 个人简历抢 Top1。
 * 用于：getPathBoost。
 */
export const PATH_BOOST_PROJECTS_RESUME = -0.2;

/** KM-09：按 profile 取 vectorTopK / maxHits。 */
export const getProfileRecallParams = (profile: QueryProfile) => ({
    vectorTopK: PROFILE_VECTOR_TOP_K[profile],
    maxHits: PROFILE_MAX_HITS[profile],
});

/** 供测试 / 脚本读取当前 KM 参数快照。 */
export const getKmRetrievalConfig = () => ({
    maxCandidates: MAX_CANDIDATES,
    maxHits: MAX_HITS,
    profileVectorTopK: PROFILE_VECTOR_TOP_K,
    profileMaxHits: PROFILE_MAX_HITS,
    excerptMax: EXCERPT_MAX,
    logBodyPreview: LOG_BODY_PREVIEW,
    scanBodyMax: SCAN_BODY_MAX,
    maxChunksPerPath: MAX_CHUNKS_PER_PATH,
    mergedChunkBodyMax: MERGED_CHUNK_BODY_MAX,
    vectorConfidentTop1Max: VECTOR_CONFIDENT_TOP1_MAX,
    vectorConfidentGapMin: VECTOR_CONFIDENT_GAP_MIN,
    vectorFetchMultiplier: VECTOR_FETCH_MULTIPLIER,
    rrfK: RRF_K,
    pathBoostPersonal: PATH_BOOST_PERSONAL,
    pathBoostExperience: PATH_BOOST_EXPERIENCE,
    pathBoostProjects: PATH_BOOST_PROJECTS,
    pathBoostProjectsResume: PATH_BOOST_PROJECTS_RESUME,
});
