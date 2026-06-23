import type { AgentPipelineContext } from "@fambrain/agent-types";
import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import {
    addStructuredUserFact,
} from "@fambrain/agent-memory";
import {
    createPendingMemoryFact,
    MemoryCandidateTarget,
} from "@fambrain/db";
import { writeLearnedFactToCorpus } from "@fambrain/corpus";
import pino from "pino";
import { indexOneCorpusUser } from "@/agentflow/agents/offline/knowledge-indexer";
import { getLearningConfig } from "./config";
import {
    extractLearnedCandidates,
    toDbTarget,
    type LearnedCandidate,
} from "./extract-candidates";

const indexLogger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const promoteToMem0 = async (
    actorUserId: string,
    candidate: LearnedCandidate
): Promise<void> => {
    await addStructuredUserFact({
        userId: actorUserId,
        factKey: candidate.factKey,
        label: candidate.label,
        value: candidate.value,
    });
};

const promoteToCorpus = async (input: {
    corpusUserId: string;
    candidate: LearnedCandidate;
    context: AgentPipelineContext;
    approvedByUserId?: string;
}): Promise<string> => {
    return writeLearnedFactToCorpus({
        corpusUserId: input.corpusUserId,
        factKey: input.candidate.factKey,
        label: input.candidate.label,
        value: input.candidate.value,
        confidence: input.candidate.confidence,
        conversationId: input.context.conversationId,
        approvedByUserId: input.approvedByUserId ?? input.context.actorUserId,
        citations: input.candidate.citations,
    });
};

export const promoteLearnedCandidate = async (input: {
    context: AgentPipelineContext;
    candidate: LearnedCandidate;
    target: MemoryCandidateTarget;
    approvedByUserId?: string;
    reindex?: boolean;
}): Promise<{ learnedPath?: string }> => {
    const { context, candidate, target } = input;
    let learnedPath: string | undefined;

    if (
        target === MemoryCandidateTarget.MEM0 ||
        target === MemoryCandidateTarget.BOTH
    ) {
        await promoteToMem0(context.actorUserId, candidate);
    }
    if (
        target === MemoryCandidateTarget.CORPUS_LEARNED ||
        target === MemoryCandidateTarget.BOTH
    ) {
        learnedPath = await promoteToCorpus({
            corpusUserId: context.corpusUserId,
            candidate,
            context,
            approvedByUserId: input.approvedByUserId,
        });
        if (input.reindex !== false) {
            await indexOneCorpusUser(context.corpusUserId, indexLogger);
        }
    }
    return { learnedPath };
};

export const persistLearningAfterTurn = async (input: {
    context: AgentPipelineContext;
    userQuestion: string;
    answer: string;
    skipImplicitMem0?: boolean;
    retrievalPaths?: string[];
}): Promise<void> => {
    const cfg = getLearningConfig();
    if (!cfg.enabled) return;

    const candidates = extractLearnedCandidates({
        userQuestion: input.userQuestion,
        assistantAnswer: input.answer,
        retrievalPaths: input.retrievalPaths,
    });
    if (candidates.length === 0) return;

    logAgentIn("Learning", "进入", {
        action: "persist_after_turn",
        candidateCount: candidates.length,
        conversationId: input.context.conversationId,
    });

    for (const candidate of candidates) {
        if (candidate.confidence < cfg.pendingBelowConfidence) continue;

        const autoMem0 =
            candidate.confidence >= cfg.autoMem0MinConfidence &&
            (candidate.target === "mem0" || candidate.target === "both");
        const autoCorpus =
            candidate.confidence >= cfg.autoCorpusMinConfidence &&
            (candidate.target === "corpus" || candidate.target === "both");

        if (autoMem0 && !autoCorpus) {
            try {
                await promoteToMem0(input.context.actorUserId, candidate);
                logAgentOut("Learning", "出去", {
                    action: "auto_mem0",
                    factKey: candidate.factKey,
                    confidence: candidate.confidence,
                });
                continue;
            }
            catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                console.warn("[Learning] auto_mem0 failed:", message);
            }
        }

        if (autoCorpus) {
            try {
                const { learnedPath } = await promoteLearnedCandidate({
                    context: input.context,
                    candidate,
                    target:
                        candidate.target === "both" ?
                            MemoryCandidateTarget.BOTH
                        :   MemoryCandidateTarget.CORPUS_LEARNED,
                    reindex: true,
                });
                logAgentOut("Learning", "出去", {
                    action: "auto_corpus",
                    factKey: candidate.factKey,
                    learnedPath,
                    confidence: candidate.confidence,
                });
                continue;
            }
            catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                console.warn("[Learning] auto_corpus failed:", message);
            }
        }

        await createPendingMemoryFact({
            userId: input.context.actorUserId,
            corpusUserId: input.context.corpusUserId,
            factKey: candidate.factKey,
            label: candidate.label,
            value: candidate.value,
            confidence: candidate.confidence,
            target: toDbTarget(candidate.target),
            sourceConversationId: input.context.conversationId,
            sourceUserQuestion: input.userQuestion,
            citations: candidate.citations,
        }).catch((e) => {
            const message = e instanceof Error ? e.message : String(e);
            console.warn("[Learning] pending create failed:", message);
        });
        logAgentOut("Learning", "出去", {
            action: "pending",
            factKey: candidate.factKey,
            confidence: candidate.confidence,
        });
    }
};

export { extractLearnedCandidates, type LearnedCandidate } from "./extract-candidates";
export { getLearningConfig, resetLearningConfigCache } from "./config";
