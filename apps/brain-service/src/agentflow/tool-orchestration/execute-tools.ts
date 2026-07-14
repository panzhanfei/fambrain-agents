import { logAgentOut } from "@fambrain/brain-shared/agent-log";
import { dedupeCitations } from "@/agentflow/brain-service/online/content-organizer";
import { composeEnumerationAnswer } from "@/agentflow/brain-service/online/information-analyst/compose-message";
import type { InformationAnalystResult } from "@/agentflow/brain-service/online/information-analyst/prompt";
import { retrieveKnowledge } from "@/agentflow/brain-service/online/knowledge-manager";
import type { KnowledgeHit } from "@/agentflow/brain-service/online/knowledge-manager";
import {
    computeAgeFromHitsTool,
    runWithToolContext,
    searchWebTool,
} from "@/agentflow/tools";
import type { PipelineGraphState } from "@/agentflow/pipeline/graph/state";
import type { RoutedIntakeDecision } from "@/agentflow/brain-service/online/intake-coordinator";
import { resolveIdentityField } from "./field-catalog";
import type {
    ExecutionPlanNode,
    PipelineToolResults,
    ToolRunId,
    ToolRunResult,
} from "./types";

const analystToToolResult = (
    toolId: ToolRunId,
    label: string,
    result: InformationAnalystResult,
    hits: KnowledgeHit[] = []
): ToolRunResult => ({
    toolId,
    label,
    ok: !result.insufficientEvidence,
    answer: result.answer,
    citations: result.citations,
    hits,
    blocks: result.blocks,
    insufficientEvidence: result.insufficientEvidence,
    confidence: result.confidence,
});

export const invokeRetrieveCorpus = async (input: {
    corpusUserId: string;
    actorUserId: string;
    searchQuery: string;
    queryType?: string;
    topics?: string[];
    subTasks?: string[];
}): Promise<{ hits: KnowledgeHit[]; coverage: string; notes: string | null }> => {
    const result = await retrieveKnowledge({
        corpusUserId: input.corpusUserId,
        searchQuery: input.searchQuery,
        topics: input.topics ?? [],
        subTasks: input.subTasks ?? [],
        queryType: (input.queryType as never) ?? null,
        candidates: [],
    });
    return {
        hits: result.hits,
        coverage: result.coverage,
        notes: result.notes,
    };
};

export const invokeSearchWeb = async (input: {
    corpusUserId: string;
    actorUserId: string;
    query: string;
}): Promise<ToolRunResult> => {
    const raw = await runWithToolContext(
        { corpusUserId: input.corpusUserId, actorUserId: input.actorUserId },
        () => searchWebTool.invoke({ query: input.query })
    );
    const parsed = JSON.parse(String(raw)) as {
        status: string;
        query: string;
        results?: Array<{ title: string; url: string; snippet: string }>;
        message?: string;
    };
    const snippets = parsed.results ?? [];
    const ok = parsed.status === "ok" && snippets.length > 0;
    const answer = ok
        ? snippets
              .slice(0, 5)
              .map((s, i) => `${i + 1}. ${s.title}：${s.snippet}`)
              .join("\n")
        : parsed.message ??
          "未配置联网搜索或暂无外部检索结果，请补充语料或配置 TAVILY_API_KEY。";
    return {
        toolId: "search_web",
        label: input.query,
        ok,
        answer,
        citations: snippets.map((s) => ({
            path: s.url,
            excerpt: s.snippet,
        })),
        hits: [],
        insufficientEvidence: !ok,
        confidence: ok ? 0.7 : 0.85,
        webSnippets: snippets,
    };
};

export const invokeComputeAge = async (input: {
    corpusUserId: string;
    actorUserId: string;
    hits: KnowledgeHit[];
    asOfDate: string;
    language: "zh" | "en" | "mixed";
    label: string;
}): Promise<ToolRunResult> => {
    const raw = await runWithToolContext(
        { corpusUserId: input.corpusUserId, actorUserId: input.actorUserId },
        () =>
            computeAgeFromHitsTool.invoke({
                hits: input.hits.map((h) => ({
                    path: h.path,
                    excerpt: h.excerpt,
                })),
                asOfDate: input.asOfDate,
                language: input.language,
            })
    );
    const parsed = JSON.parse(String(raw)) as {
        answer: string;
        insufficientEvidence: boolean;
        sourcePath: string | null;
    };
    const citations =
        parsed.sourcePath && input.hits[0]
            ? dedupeCitations([
                  {
                      path: parsed.sourcePath,
                      excerpt: input.hits[0]!.excerpt,
                  },
              ])
            : [];
    return {
        toolId: "compute_age_from_hits",
        label: input.label,
        ok: !parsed.insufficientEvidence,
        answer: parsed.answer,
        citations,
        hits: input.hits,
        insufficientEvidence: parsed.insufficientEvidence,
        confidence: parsed.insufficientEvidence ? 0.85 : 0.9,
    };
};

export const invokeComposeEnumeration = (input: {
    hits: KnowledgeHit[];
    language: "zh" | "en" | "mixed";
    topics: string[];
    label: string;
    enumerationMeta: PipelineGraphState["enumerationMeta"];
    notes: string | null;
    listIntent: RoutedIntakeDecision["listIntent"];
}): ToolRunResult => {
    const result = composeEnumerationAnswer({
        hits: input.hits,
        language: input.language,
        topics: input.topics,
        label: input.label,
        enumerationMeta: input.enumerationMeta,
        notes: input.notes,
        listIntent: input.listIntent,
    });
    return analystToToolResult(
        "compose_enumeration",
        input.label,
        result,
        input.hits
    );
};

export const invokeSynthesizeMerge = (input: {
    label: string;
    deps: ToolRunResult[];
}): ToolRunResult => {
    const resume = input.deps.find((d) => d.toolId === "retrieve_corpus");
    const webs = input.deps.filter((d) => d.toolId === "search_web");
    const sections: string[] = [];
    if (resume?.answer) {
        sections.push(`【个人档案摘要】\n${resume.answer.slice(0, 800)}`);
    }
    for (const w of webs) {
        if (w.answer) sections.push(`【${w.label}】\n${w.answer}`);
    }
    const answer =
        sections.length > 0
            ? `${sections.join("\n\n")}\n\n（以上为语料与外部检索摘录的综合材料；具体匹配结论请结合各段证据判断，勿编造未出现的事实。）`
            : "综合评估所需材料不足（简历或外部检索未返回有效内容）。";
    const citations = dedupeCitations(input.deps.flatMap((d) => d.citations));
    return {
        toolId: "synthesize_merge",
        label: input.label,
        ok: sections.length >= 2,
        answer,
        citations,
        hits: resume?.hits ?? [],
        insufficientEvidence: sections.length < 2,
        confidence: sections.length >= 2 ? 0.72 : 0.85,
    };
};

export const runExecutionPlanNode = async (
    node: ExecutionPlanNode,
    ctx: {
        state: PipelineGraphState;
        prior: PipelineToolResults;
    }
): Promise<ToolRunResult> => {
    const { state, prior } = ctx;
    const { corpusUserId, actorUserId } = state.context;
    const language = state.decision?.language ?? "zh";

    switch (node.toolId) {
        case "retrieve_corpus": {
            const retrieved = await invokeRetrieveCorpus({
                corpusUserId,
                actorUserId,
                searchQuery: node.searchQuery ?? state.userQuestion,
                queryType: node.queryType,
                topics: node.topics,
                subTasks: [node.label],
            });
            const answer =
                retrieved.hits.length > 0
                    ? retrieved.hits
                          .slice(0, 3)
                          .map((h) => `${h.title}：${h.excerpt.slice(0, 120)}`)
                          .join("\n")
                    : "语料未检索到相关内容。";
            return {
                toolId: "retrieve_corpus",
                label: node.label,
                ok: retrieved.hits.length > 0,
                answer,
                citations: dedupeCitations(
                    retrieved.hits.slice(0, 3).map((h) => ({
                        path: h.path,
                        excerpt: h.excerpt,
                    }))
                ),
                hits: retrieved.hits,
                insufficientEvidence: retrieved.hits.length === 0,
                confidence: retrieved.hits.length > 0 ? 0.75 : 0.85,
            };
        }
        case "search_web":
            return invokeSearchWeb({
                corpusUserId,
                actorUserId,
                query: node.webQuery ?? node.searchQuery ?? state.userQuestion,
            });
        case "compute_age_from_hits": {
            const hits = node.hitsOverride ?? state.hits;
            return invokeComputeAge({
                corpusUserId,
                actorUserId,
                hits,
                asOfDate: state.asOfDate ?? new Date().toISOString().slice(0, 10),
                language,
                label: node.label,
            });
        }
        case "compose_enumeration":
            return invokeComposeEnumeration({
                hits: node.hitsOverride ?? state.hits,
                language,
                topics: node.topics ?? state.decision?.topics ?? [],
                label: node.label,
                enumerationMeta:
                    node.enumerationMetaOverride ?? state.enumerationMeta,
                notes: state.notes,
                listIntent: state.decision?.listIntent ?? null,
            });
        case "synthesize_merge": {
            const deps = node.deps.map((id) => prior[id]).filter(Boolean) as ToolRunResult[];
            return invokeSynthesizeMerge({ label: node.label, deps });
        }
        default:
            return {
                toolId: node.toolId,
                label: node.label,
                ok: false,
                answer: `未知工具：${node.toolId}`,
                citations: [],
                hits: [],
                insufficientEvidence: true,
                confidence: 0.5,
            };
    }
};

const topoWaves = (nodes: ExecutionPlanNode[]): ExecutionPlanNode[][] => {
    const idSet = new Set(nodes.map((n) => n.id));
    const remaining = new Map(nodes.map((n) => [n.id, n]));
    const waves: ExecutionPlanNode[][] = [];
    while (remaining.size > 0) {
        const wave = [...remaining.values()].filter((n) =>
            n.deps.every((d) => !remaining.has(d) && idSet.has(d))
        );
        if (wave.length === 0) break;
        waves.push(wave);
        for (const n of wave) remaining.delete(n.id);
    }
    return waves;
};

export const executeDagPlan = async (
    plan: ExecutionPlanNode[],
    state: PipelineGraphState
): Promise<PipelineToolResults> => {
    const results: PipelineToolResults = {};
    for (const wave of topoWaves(plan)) {
        const settled = await Promise.all(
            wave.map(async (node) => {
                const result = await runExecutionPlanNode(node, {
                    state,
                    prior: results,
                });
                return [node.id, result] as const;
            })
        );
        for (const [id, result] of settled) results[id] = result;
    }
    logAgentOut("DagExecutor", "完成", {
        nodeIds: Object.keys(results),
        synthesis: results.synthesis?.ok ?? null,
    });
    return results;
};

export const resolvePostRetrievalToolRuns = (
    state: PipelineGraphState
): Array<{ key: string; node: ExecutionPlanNode }> => {
    const decision = state.decision;
    if (!decision) return [];

    const runs: Array<{ key: string; node: ExecutionPlanNode }> = [];
    const enrichedSlots = (decision.compositeSlots ?? []) as Array<
        (typeof decision.compositeSlots)[number] & {
            toolId?: ToolRunId | null;
            dataSource?: string;
            field?: string | null;
        }
    >;

    if (
        decision.routeMode === "slots" &&
        state.compositeSubResults
    ) {
        for (const sub of state.compositeSubResults) {
            const slot = enrichedSlots.find((s) => s.id === sub.slot);
            if (!slot?.toolId || sub.hits.length === 0 || sub.coverage === "none") {
                continue;
            }
            runs.push({
                key: `slot_${sub.slot}`,
                node: {
                    id: sub.slot,
                    label: sub.label,
                    dataSource:
                        slot.toolId === "search_web"
                            ? "web"
                            : slot.toolId === "compute_age_from_hits"
                              ? "compute"
                              : "corpus",
                    toolId: slot.toolId,
                    queryType: slot.queryType,
                    topics: slot.topics,
                    field: slot.field ?? null,
                    deps: [],
                    hitsOverride: sub.hits,
                    enumerationMetaOverride: sub.enumerationMeta ?? null,
                },
            });
        }
        return runs;
    }

    if (decision.primaryDataSource === "web" && decision.webQuery) {
        const corpusWeak =
            state.hits.length === 0 || state.coverage === "none";
        if (corpusWeak || decision.webQuery.length > 0) {
            runs.push({
                key: "web",
                node: {
                    id: "web",
                    label: "外部检索",
                    dataSource: "web",
                    toolId: "search_web",
                    webQuery: decision.webQuery,
                    deps: [],
                },
            });
        }
    }

    const enriched =
        decision.enrichedPlan ??
        (decision.retrievalPlan ?? []).map((p) => ({
            ...p,
            dataSource: "corpus" as const,
            field: resolveIdentityField(p.label)?.id ?? null,
            toolId: null as ToolRunId | null,
        }));

    const enumItem = enriched.find(
        (p) => p.toolId === "compose_enumeration" || p.queryType === "enumeration"
    );
    if (enumItem && state.hits.length > 0 && decision.queryType === "enumeration") {
        runs.push({
            key: "enumeration",
            node: {
                id: "enumeration",
                label: enumItem.label,
                dataSource: "corpus",
                toolId: "compose_enumeration",
                queryType: "enumeration",
                topics: enumItem.topics,
                deps: [],
            },
        });
    }

    const ageItem =
        enriched.find((p) => p.toolId === "compute_age_from_hits") ??
        (decision.queryType === "identity" &&
        resolveIdentityField(state.userQuestion)?.toolId === "compute_age_from_hits"
            ? {
                  label: "年龄",
                  toolId: "compute_age_from_hits" as const,
                  field: "age",
              }
            : null);

    if (
        ageItem &&
        state.hits.length > 0 &&
        state.coverage !== "none"
    ) {
        runs.push({
            key: "age",
            node: {
                id: "age",
                label: ageItem.label ?? "年龄",
                dataSource: "compute",
                toolId: "compute_age_from_hits",
                field: "age",
                deps: [],
            },
        });
    }

    return runs;
};
