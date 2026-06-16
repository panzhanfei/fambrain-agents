/**
 * KnowledgeManager 检索参数（KM-04 集中配置）。
 * 后续 path 加权、queryProfile 分档等亦在此扩展。
 */

/** 向量 topK / 扫盘 / merge 后保留的候选条数上限。用于：loadCandidates、mergeCandidates、scanDocCandidates 截断。 */
export const MAX_CANDIDATES = 12;

/** 最终输出 hits 条数上限。用于：retrieveByKeywords 的 slice。 */
export const MAX_HITS = 5;

/** 单条 hit 的 excerpt 最大字符数。用于：pickExcerpt、ensureNonEmptyHits 截断。 */
export const EXCERPT_MAX = 320;

/** agent-log 📤 里 body / excerpt 预览长度。用于：summarizeCandidate、summarizeRetrievalOut。 */
export const LOG_BODY_PREVIEW = 160;

/** 关键词扫盘读盘时，单文件 body 读入上限（避免大 md 占内存）。用于：scanDocCandidates。 */
export const SCAN_BODY_MAX = 4000;

/**
 * Chroma L2 距离：越小越相似。
 * top1 距离 ≤ 此值视为「向量高置信」，可跳过扫盘。用于：isVectorConfident。
 */
export const VECTOR_CONFIDENT_TOP1_MAX = 1.25;

/**
 * top1 与 top2 的 L2 距离差 ≥ 此值视为「无歧义」。
 * 与 TOP1_MAX 一起决定是否仅走向量候选。用于：isVectorConfident。
 */
export const VECTOR_CONFIDENT_GAP_MIN = 0.12;

/** 供测试 / 脚本读取当前 KM 参数快照。 */
export const getKmRetrievalConfig = () => ({
    maxCandidates: MAX_CANDIDATES,
    maxHits: MAX_HITS,
    excerptMax: EXCERPT_MAX,
    logBodyPreview: LOG_BODY_PREVIEW,
    scanBodyMax: SCAN_BODY_MAX,
    vectorConfidentTop1Max: VECTOR_CONFIDENT_TOP1_MAX,
    vectorConfidentGapMin: VECTOR_CONFIDENT_GAP_MIN,
});
