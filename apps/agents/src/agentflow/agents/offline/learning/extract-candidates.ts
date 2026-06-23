import { normalizeFactKey } from "@/agentflow/agents/online/intake-coordinator/user-fact";

export type LearnedCandidateTarget = "mem0" | "corpus" | "both";

export type LearnedCandidate = {
    factKey: string;
    label: string;
    value: string;
    confidence: number;
    target: LearnedCandidateTarget;
    citations?: string[];
};

const REMEMBER_LINE =
    /(?:请记住|帮我记住|记一下|记下)(?:我的)?(.{0,24})?[是为：:\s]+(.{1,200})/i;
const MY_FACT_LINE = /我的(.{1,24}?)[是为：:\s]+(.{1,200})/i;
const I_AM_LINE = /我(?:叫|是)(.{1,40})/i;
const PREFERENCE_LINE = /我(?:更)?(?:喜欢|偏好|倾向)(.{1,80})/i;

const trimCandidatePart = (raw: string): string => raw.trim().replace(/[。！？!?.]+$/u, "");

const pushUnique = (
    out: LearnedCandidate[],
    seen: Set<string>,
    candidate: LearnedCandidate
): void => {
    const key = `${candidate.factKey}:${candidate.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
};

/** 从用户句抽取可学习的结构化 fact（规则路径，无额外 LLM 调用） */
export const extractLearnedCandidates = (input: {
    userQuestion: string;
    assistantAnswer: string;
    retrievalPaths?: string[];
}): LearnedCandidate[] => {
    const q = input.userQuestion.trim();
    if (!q || q.length < 4) return [];

    const out: LearnedCandidate[] = [];
    const seen = new Set<string>();
    const citations =
        input.retrievalPaths?.filter(Boolean).slice(0, 5) ?? [];

    const remember = q.match(REMEMBER_LINE);
    if (remember) {
        const label = trimCandidatePart(remember[1] || "备注");
        const value = trimCandidatePart(remember[2] || "");
        if (value) {
            pushUnique(out, seen, {
                factKey: normalizeFactKey(label),
                label,
                value,
                confidence: 0.9,
                target: citations.length ? "both" : "mem0",
                citations: citations.length ? citations : undefined,
            });
        }
    }

    const myFact = q.match(MY_FACT_LINE);
    if (myFact) {
        const label = trimCandidatePart(myFact[1] || "信息");
        const value = trimCandidatePart(myFact[2] || "");
        if (value && !seen.has(`${normalizeFactKey(label)}:${value}`)) {
            pushUnique(out, seen, {
                factKey: normalizeFactKey(label),
                label,
                value,
                confidence: 0.82,
                target: citations.length ? "both" : "mem0",
                citations: citations.length ? citations : undefined,
            });
        }
    }

    const iAm = q.match(I_AM_LINE);
    if (iAm) {
        const value = trimCandidatePart(iAm[1] || "");
        if (value.length >= 2) {
            pushUnique(out, seen, {
                factKey: "identity",
                label: "身份",
                value,
                confidence: 0.78,
                target: "mem0",
            });
        }
    }

    const pref = q.match(PREFERENCE_LINE);
    if (pref) {
        const value = trimCandidatePart(pref[1] || "");
        if (value.length >= 2) {
            pushUnique(out, seen, {
                factKey: "preference",
                label: "偏好",
                value,
                confidence: 0.8,
                target: "mem0",
            });
        }
    }

    return out;
};

export const toDbTarget = (
    target: LearnedCandidateTarget
): "MEM0" | "CORPUS_LEARNED" | "BOTH" => {
    if (target === "corpus") return "CORPUS_LEARNED";
    if (target === "both") return "BOTH";
    return "MEM0";
};
