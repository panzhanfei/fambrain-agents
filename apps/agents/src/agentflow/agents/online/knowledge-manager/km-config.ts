/** KM 检索参数（KM-04：集中配置，后续 path 加权 / profile 分档亦在此扩展） */

export const MAX_CANDIDATES = 12;
export const MAX_HITS = 5;
export const EXCERPT_MAX = 320;
export const LOG_BODY_PREVIEW = 160;
/** 关键词扫盘单文件 body 上限 */
export const SCAN_BODY_MAX = 4000;

/** Chroma L2 距离：越小越相似；top1 低于此视为向量高置信 */
export const VECTOR_CONFIDENT_TOP1_MAX = 1.25;
/** top1 与 top2 距离差至少此值视为无歧义（L2） */
export const VECTOR_CONFIDENT_GAP_MIN = 0.12;

export const getKmRetrievalConfig = () => ({
    maxCandidates: MAX_CANDIDATES,
    maxHits: MAX_HITS,
    excerptMax: EXCERPT_MAX,
    logBodyPreview: LOG_BODY_PREVIEW,
    scanBodyMax: SCAN_BODY_MAX,
    vectorConfidentTop1Max: VECTOR_CONFIDENT_TOP1_MAX,
    vectorConfidentGapMin: VECTOR_CONFIDENT_GAP_MIN,
});
