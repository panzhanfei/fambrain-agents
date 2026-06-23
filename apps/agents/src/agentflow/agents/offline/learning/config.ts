const envFlag = (name: string, defaultOn = true): boolean => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return defaultOn;
    const s = raw.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes") return true;
    if (s === "0" || s === "false" || s === "no") return false;
    return defaultOn;
};

const envFloat = (name: string, fallback: number): number => {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

export type LearningConfig = {
    enabled: boolean;
    autoMem0MinConfidence: number;
    autoCorpusMinConfidence: number;
    pendingBelowConfidence: number;
};

let cached: LearningConfig | null = null;

export const resetLearningConfigCache = (): void => {
    cached = null;
};

export const getLearningConfig = (): LearningConfig => {
    if (cached) return cached;
    cached = {
        enabled: envFlag("LEARNING_PIPELINE_ENABLED", true),
        autoMem0MinConfidence: envFloat("LEARNING_AUTO_MEM0_MIN_CONFIDENCE", 0.85),
        autoCorpusMinConfidence: envFloat("LEARNING_AUTO_CORPUS_MIN_CONFIDENCE", 0.92),
        pendingBelowConfidence: envFloat("LEARNING_PENDING_MIN_CONFIDENCE", 0.55),
    };
    return cached;
};
