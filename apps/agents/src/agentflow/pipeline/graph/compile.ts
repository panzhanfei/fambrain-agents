import { END, START, StateGraph, getWriter } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { organizeKnowledge } from "@/agentflow/agents/online/content-organizer";
import { resolveQueryProfile } from "@/agentflow/agents/online/knowledge-manager/query-profile";
import { buildSummarizeSourceText, formatSummaryAsAnswer, summarizeContent, } from "@/agentflow/agents/online/content-summarizer";
import { completeFactCheck } from "@/agentflow/agents/online/fact-checker";
import { completeIntakeCoordinator } from "@/agentflow/agents/online/intake-coordinator";
import { applyIntakeChitchatGuard } from "@/agentflow/agents/online/intake-coordinator/intake-chitchat-guard";
import { applyCompositeRouteGuard } from "@/agentflow/agents/online/intake-coordinator/composite-route-guard";
import { applyIntakeCoreferenceGuard } from "@/agentflow/agents/online/intake-coordinator/intake-coreference-guard";
import { applyIntakeRetrievalPlanGuard } from "@/agentflow/agents/online/intake-coordinator/intake-retrieval-plan-guard";
import { findRepeatAnswerInHistory } from "@/agentflow/agents/online/intake-coordinator/intake-repeat-guard";
import { resolveIncrementalCompositePlan } from "@/agentflow/agents/online/intake-coordinator/composite-incremental";
import { streamAnalyzeInformation } from "@/agentflow/agents/online/information-analyst";
import { retrieveKnowledge } from "@/agentflow/agents/online/knowledge-manager";
import { retrieveCompositeIncremental } from "./retrieve-composite-incremental";
import {
    getRetrievalFromCache,
    setRetrievalCache,
} from "@fambrain/infra";
import { defaultIntakeDecision, parseIntakeDecision } from "../parse-intake";
import { PipelineGraphAnnotation, type PipelineGraphState } from "./state";
const routeAfterIntake = (state: PipelineGraphState): "respondEarly" | "retrieval" | "factChecker" | "contentSummarizer" => {
    if (state.exitEarly || state.error)
        return "respondEarly";
    const decision = state.decision;
    if (!decision)
        return "respondEarly";
    if (decision.intent === "clarify" && decision.clarifyingQuestion) {
        return "respondEarly";
    }
    if ((decision.intent === "chitchat" || decision.intent === "out_of_scope") &&
        decision.briefReply) {
        return "respondEarly";
    }
    if (decision.intent === "summarize_content") {
        if (decision.needsRetrieval)
            return "retrieval";
        return "contentSummarizer";
    }
    if (decision.needsRetrieval)
        return "retrieval";
    if (!decision.needsRetrieval && decision.briefReply) {
        return "respondEarly";
    }
    return "factChecker";
};
const routeAfterRetrieval = (state: PipelineGraphState): "factChecker" | "contentSummarizer" => {
    if (state.decision?.intent === "summarize_content") {
        return "contentSummarizer";
    }
    return "factChecker";
};
const routeAfterFactChecker = (state: PipelineGraphState): "retrieval" | "contentOrganizer" => {
    if (!state.checkerPassed && state.retryCount < 1) {
        return "retrieval";
    }
    return "contentOrganizer";
};
const intakeNode = async (state: PipelineGraphState): Promise<Partial<PipelineGraphState>> => {
    const repeatAnswer = findRepeatAnswerInHistory(
        state.intakeHistory,
        state.userQuestion
    );
    if (repeatAnswer) {
        return {
            answer: repeatAnswer,
            exitEarly: true,
            repeatQuestionHit: true,
        };
    }
    try {
        const intakeRaw = await completeIntakeCoordinator(state.intakeHistory, {
            memoryBlock: state.memoryBlock,
            intakeHistory: state.intakeHistory,
        });
        const parsed = parseIntakeDecision(intakeRaw) ??
            defaultIntakeDecision(state.userQuestion);
        const decision = applyCompositeRouteGuard(
            applyIntakeRetrievalPlanGuard(
                applyIntakeChitchatGuard(
                    applyIntakeCoreferenceGuard(parsed, state.intakeHistory)
                ),
                state.userQuestion
            ),
            state.userQuestion
        );
        return { decision };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "入口接线员调用失败，请确认 Ollama 可用";
        return {
            error: msg,
            answer: "（模型调用失败：请确认本地 Ollama 已启动且模型已拉取）",
            exitEarly: true,
        };
    }
};
const retrievalNode = async (state: PipelineGraphState): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return { error: "缺少入口路由决策" };
    }
    const fromRetry = !state.checkerPassed && state.retryCount < 1;
    const routeMode = decision.routeMode ?? "single";

    if (routeMode === "composite" || routeMode === "slot") {
        const slots = decision.compositeSlots ?? [];
        if (slots.length === 0) {
            return { error: "composite 路由缺少槽位定义" };
        }
        try {
            const incremental = await resolveIncrementalCompositePlan({
                session: {
                    conversationId: state.context.conversationId,
                    corpusUserId: state.context.corpusUserId,
                },
                userQuestion: state.userQuestion,
                slots,
            });
            const { subResults, cacheHits, merged } =
                await retrieveCompositeIncremental({
                    corpusUserId: state.context.corpusUserId,
                    plan: incremental,
                });
            return {
                hits: merged.hits,
                coverage: merged.coverage,
                notes: merged.notes,
                confidenceTier: merged.confidenceTier,
                compositeSubResults: subResults,
                compositeIncrementalPlan: incremental,
                compositeFacetCacheHits: incremental.facetCacheHits,
                retrievalCacheSlotHits: cacheHits,
                retrievalCacheHit:
                    incremental.activeRetrievalSlots.length > 0 &&
                    cacheHits === incremental.activeRetrievalSlots.length,
                retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
            };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : "composite 检索失败";
            return {
                error: msg,
                retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
            };
        }
    }

    const searchQuery = decision.searchQuery || state.userQuestion;
    const queryType = decision.queryType ?? "default";
    const cacheKey = {
        corpusUserId: state.context.corpusUserId,
        searchQuery,
        queryType,
    };
    try {
        const cached = await getRetrievalFromCache(cacheKey);
        if (cached) {
            return {
                hits: cached.hits,
                coverage: cached.coverage,
                notes: cached.notes,
                confidenceTier: cached.confidenceTier ?? null,
                retrievalCacheHit: true,
                retrievalCacheSlotHits: null,
                compositeSubResults: null,
                retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
            };
        }
        const retrieval = await retrieveKnowledge({
            corpusUserId: state.context.corpusUserId,
            searchQuery,
            topics: decision.topics,
            subTasks: decision.subTasks,
            queryType: decision.queryType,
            candidates: [],
        });
        await setRetrievalCache(cacheKey, {
            hits: retrieval.hits,
            coverage: retrieval.coverage,
            notes: retrieval.notes,
            confidenceTier: retrieval.confidenceTier,
            confidenceScore: retrieval.confidenceScore,
        });
        return {
            hits: retrieval.hits,
            coverage: retrieval.coverage,
            notes: retrieval.notes,
            confidenceTier: retrieval.confidenceTier ?? null,
            retrievalCacheHit: false,
            retrievalCacheSlotHits: null,
            compositeSubResults: null,
            retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "知识库检索失败";
        return {
            error: msg,
            retryCount: fromRetry ? state.retryCount + 1 : state.retryCount,
        };
    }
};
const mergeAnalystNotes = (kmNotes: string | null, checkerNotes: string | null): string | null => {
    const parts = [kmNotes, checkerNotes].filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    return parts.length > 0 ? parts.join(" ") : null;
};
const factCheckerNode = async (state: PipelineGraphState): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return { checkerPassed: true };
    }
    const compositeCount = state.compositeSubResults?.length ?? 0;
    if (
        decision.routeMode === "composite" &&
        compositeCount >= 2
    ) {
        return {
            checkerPassed: true,
            notes: state.notes,
        };
    }
    try {
        const result = await completeFactCheck({
            userQuestion: state.userQuestion,
            intent: decision.intent,
            needsRetrieval: decision.needsRetrieval,
            searchQuery: decision.searchQuery || state.userQuestion,
            subTasks: decision.subTasks,
            topics: decision.topics,
            language: decision.language,
            hits: state.hits,
            coverage: state.coverage,
            notes: state.notes,
            retryCount: state.retryCount,
            confidenceTier: state.confidenceTier,
            retrievalCacheHit: state.retrievalCacheHit,
        });
        const patch: Partial<PipelineGraphState> = {
            checkerPassed: result.passed,
            notes: mergeAnalystNotes(state.notes, result.checkerNotes),
        };
        if (
            !result.passed &&
            result.refinedSearchQuery &&
            state.retryCount < 1 &&
            (decision.routeMode ?? "single") === "single"
        ) {
            patch.decision = {
                ...decision,
                searchQuery: result.refinedSearchQuery,
            };
        }
        return patch;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "事实核查员调用失败";
        return { checkerPassed: true, error: msg };
    }
};
const contentSummarizerNode = async (state: PipelineGraphState): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return {
            answer: "（未能理解摘要请求，请说明要总结的项目或文档）",
            exitEarly: true,
        };
    }
    try {
        const { text, sourceLabel } = buildSummarizeSourceText({
            userQuestion: state.userQuestion,
            decision,
            hits: state.hits,
        });
        if (!text.trim()) {
            return {
                answer: "（没有可摘要的正文，请先说明要总结的项目或粘贴内容）",
                exitEarly: true,
            };
        }
        const summary = await summarizeContent({
            text,
            sourceLabel,
            language: decision.language,
        });
        const answer = formatSummaryAsAnswer(summary);
        return { answer, exitEarly: true };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "内容摘要师调用失败";
        return {
            error: msg,
            answer: "（生成摘要时出错，请稍后重试）",
            exitEarly: true,
        };
    }
};
const contentOrganizerNode = async (state: PipelineGraphState): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    const queryProfile = decision
        ? resolveQueryProfile(
              decision.searchQuery || state.userQuestion,
              decision.subTasks,
              decision.queryType
          )
        : undefined;
    const organized = organizeKnowledge({
        hits: state.hits,
        coverage: state.coverage,
        notes: state.notes,
        queryProfile,
    });
    return {
        hits: organized.hits,
        coverage: organized.coverage,
        notes: organized.notes,
    };
};
const analystNode = async (state: PipelineGraphState, config: LangGraphRunnableConfig): Promise<Partial<PipelineGraphState>> => {
    const decision = state.decision;
    if (!decision) {
        return { answer: "（未能理解您的问题，请换一种方式描述）" };
    }
    const write = getWriter(config);
    try {
        const gen = streamAnalyzeInformation({
            userQuestion: state.userQuestion,
            language: decision.language,
            subTasks: decision.subTasks,
            hits: state.hits,
            coverage: state.coverage,
            notes: state.notes,
            memoryBlock: state.memoryBlock,
            routeMode: decision.routeMode ?? "single",
            queryType: decision.queryType,
            searchQuery: decision.searchQuery,
            topics: decision.topics,
            compositeSubResults: state.compositeSubResults ?? undefined,
            compositeIncrementalPlan:
                state.compositeIncrementalPlan ?? undefined,
            sessionKey: {
                conversationId: state.context.conversationId,
                corpusUserId: state.context.corpusUserId,
            },
        });
        let result = await gen.next();
        while (!result.done) {
            write?.(result.value);
            result = await gen.next();
        }
        return { answer: result.value.answer };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "信息分析师调用失败";
        const answer = "（生成回答时出错，请稍后重试）";
        write?.({ type: "assistant", text: answer });
        return { error: msg, answer };
    }
};
const respondEarlyNode = (state: PipelineGraphState): Partial<PipelineGraphState> => {
    if (state.answer) {
        return { exitEarly: true };
    }
    const decision = state.decision;
    if (!decision) {
        return {
            answer: "（未能理解您的问题，请换一种方式描述）",
            exitEarly: true,
        };
    }
    if (decision.intent === "clarify" && decision.clarifyingQuestion) {
        return { answer: decision.clarifyingQuestion, exitEarly: true };
    }
    if (decision.briefReply) {
        return { answer: decision.briefReply, exitEarly: true };
    }
    return {
        answer: "（未能生成回复，请稍后重试）",
        exitEarly: true,
    };
};
const buildPipelineGraph = () => {
    return new StateGraph(PipelineGraphAnnotation)
        .addNode("intake", intakeNode)
        .addNode("retrieval", retrievalNode)
        .addNode("factChecker", factCheckerNode)
        .addNode("contentSummarizer", contentSummarizerNode)
        .addNode("contentOrganizer", contentOrganizerNode)
        .addNode("analyst", analystNode)
        .addNode("respondEarly", respondEarlyNode)
        .addEdge(START, "intake")
        .addConditionalEdges("intake", routeAfterIntake)
        .addConditionalEdges("retrieval", routeAfterRetrieval)
        .addConditionalEdges("factChecker", routeAfterFactChecker)
        .addEdge("contentSummarizer", "respondEarly")
        .addEdge("contentOrganizer", "analyst")
        .addEdge("analyst", END)
        .addEdge("respondEarly", END);
};
let compiledGraph: ReturnType<ReturnType<typeof buildPipelineGraph>["compile"]> | null = null;
export const getCompiledPipelineGraph = () => {
    if (!compiledGraph) {
        compiledGraph = buildPipelineGraph().compile({ name: "fambrain-pipeline" });
    }
    return compiledGraph;
};
