/**
 * golden.json 断言解释器（Eval MVP）。
 */
export type JsonAssert = {
    minHits?: number;
    maxHits?: number;
    topPathRe?: string;
    notTopPathRe?: string;
    excerptRe?: string;
    coverage?: "sufficient" | "partial" | "none";
    notesRe?: string;
    minExperienceHits?: number;
    noProjectsInHits?: boolean;
    expectProfile?: string;
    expectConfidenceTier?: string;
    mustIncludeSteps?: string[];
    mustNotIncludeSteps?: string[];
    minAnswerLength?: number;
    answerRe?: string;
    answerMustNotRe?: string;
};

export type KmEvalSnapshot = {
    hits: { path: string; excerpt: string; relevance: number }[];
    coverage: string;
    notes: string | null;
    queryProfile: string;
    candidateCount: number;
    recallSource: string;
    confidenceTier?: string;
    confidenceScore?: number;
    latencyMs: number;
};

export type PipelineEvalSnapshot = {
    steps: string[];
    answer: string;
    error?: string;
    hitCount: number;
    coverage: string;
    latencyMs: number;
    cacheHit?: boolean;
};

const re = (pattern: string): RegExp => new RegExp(pattern, "i");

export const assertKm = (
    snap: KmEvalSnapshot,
    assert: JsonAssert
): string[] => {
    const issues: string[] = [];
    if (assert.expectProfile && snap.queryProfile !== assert.expectProfile) {
        issues.push(
            `profile 期望 ${assert.expectProfile} 实际 ${snap.queryProfile}`
        );
    }
    if (assert.minHits !== undefined && snap.hits.length < assert.minHits) {
        issues.push(`hits 期望 >=${assert.minHits} 实际 ${snap.hits.length}`);
    }
    if (assert.maxHits !== undefined && snap.hits.length > assert.maxHits) {
        issues.push(`hits 期望 <=${assert.maxHits} 实际 ${snap.hits.length}`);
    }
    if (assert.coverage && snap.coverage !== assert.coverage) {
        issues.push(`coverage 期望 ${assert.coverage} 实际 ${snap.coverage}`);
    }
    const top = snap.hits[0];
    if (assert.topPathRe && top && !re(assert.topPathRe).test(top.path)) {
        issues.push(`Top1 path 未匹配 /${assert.topPathRe}/`);
    }
    if (assert.notTopPathRe && top && re(assert.notTopPathRe).test(top.path)) {
        issues.push(`Top1 不应匹配 /${assert.notTopPathRe}/`);
    }
    if (assert.excerptRe && top && !re(assert.excerptRe).test(top.excerpt)) {
        issues.push(`Top1 excerpt 未匹配 /${assert.excerptRe}/`);
    }
    if (assert.minExperienceHits !== undefined) {
        const n = snap.hits.filter(
            (h) =>
                /\/experience\//i.test(h.path) && !/readme/i.test(h.path)
        ).length;
        if (n < assert.minExperienceHits) {
            issues.push(
                `experience hits 期望 >=${assert.minExperienceHits} 实际 ${n}`
            );
        }
    }
    if (assert.noProjectsInHits && snap.hits.some((h) => /\/projects\//i.test(h.path))) {
        issues.push("hits 不应含 projects/");
    }
    if (assert.notesRe && (!snap.notes || !re(assert.notesRe).test(snap.notes))) {
        issues.push(`notes 未匹配 /${assert.notesRe}/`);
    }
    if (snap.candidateCount > 0 && snap.hits.length === 0) {
        issues.push("D3-2：candidates>0 但 hits=0");
    }
    if (
        assert.expectConfidenceTier &&
        snap.confidenceTier !== assert.expectConfidenceTier
    ) {
        issues.push(
            `confidenceTier 期望 ${assert.expectConfidenceTier} 实际 ${snap.confidenceTier ?? "null"}`
        );
    }
    return issues;
};

export const assertPipeline = (
    snap: PipelineEvalSnapshot,
    assert: JsonAssert
): string[] => {
    const issues: string[] = [];
    if (snap.error) issues.push(`pipeline error: ${snap.error}`);
    for (const step of assert.mustIncludeSteps ?? []) {
        if (!snap.steps.includes(step)) {
            issues.push(`缺少 step: ${step}`);
        }
    }
    for (const step of assert.mustNotIncludeSteps ?? []) {
        if (snap.steps.includes(step)) {
            issues.push(`不应有 step: ${step}`);
        }
    }
    if (assert.minAnswerLength !== undefined) {
        const len = snap.answer.trim().length;
        if (len < assert.minAnswerLength) {
            issues.push(`answer 长度期望 >=${assert.minAnswerLength} 实际 ${len}`);
        }
    }
    if (assert.answerRe && !re(assert.answerRe).test(snap.answer)) {
        issues.push(`answer 未匹配 /${assert.answerRe}/`);
    }
    if (
        assert.answerMustNotRe &&
        re(assert.answerMustNotRe).test(snap.answer)
    ) {
        issues.push(`answer 不应匹配 /${assert.answerMustNotRe}/`);
    }
    return issues;
};
