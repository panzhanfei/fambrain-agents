export { retrieveKnowledge } from "./recall/retrieve";
export {
    MAX_CANDIDATES,
    getKmRetrievalConfig,
    getProfileRecallParams,
    PROFILE_MAX_HITS,
} from "./profile/km-config";
export { inferQueryProfile, resolveQueryProfile } from "./profile/query-profile";
export { searchCorpusVectors } from "@fambrain/corpus/corpus-vector";
export {
    knowledgeHitSchema,
    knowledgeHitsSchema,
    knowledgeRetrievalResultSchema,
    parseKnowledgeHits,
    parseKnowledgeRetrievalResult,
} from "./contract/schema";
export {
    type KnowledgeHit,
    type KnowledgeManagerInput,
    type KnowledgeRetrievalResult,
    type QueryProfile,
    type ConfidenceTier,
    type KnowledgeCandidate,
    type RecallChannel,
    type RecallSource,
} from "./contract/types";
export {
    mergeCompositeHits,
    mergeCompositeRetrieval,
    type CompositeRetrievePlan,
    type CompositeSubRetrieval,
} from "./pipeline/merge-composite-retrieval";
export { retrieveCompositeIncremental } from "./pipeline/retrieve-composite-incremental";
export { retrieveCompositeSlotsParallel } from "./pipeline/retrieve-slots-parallel";
export { retrieveSlotWithCache } from "./pipeline/retrieve-with-cache";
export { runRetrievalNode } from "./nodes/retrieval-node";
export {
    assessConfidence,
    deriveCoverageFromTier,
    shouldCoalesceEmptyHits,
} from "./profile/score-candidate";
export { hybridRecall } from "./recall/hybrid-recall";
export { fuseRrf } from "./recall/fusion-rrf";
