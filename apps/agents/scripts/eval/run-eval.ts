/**
 * Eval MVP：golden.json → Pipeline / KM 断言 → JSON + Markdown 报告。
 *
 *   pnpm --filter @fambrain/agents run eval:run
 *   pnpm --filter @fambrain/agents run eval:run -- --json-only
 *   EVAL_WRITE_REPORT=1 pnpm --filter @fambrain/agents run eval:run
 *
 * 需 Ollama + 语料；KM hybrid 指标建议 Chroma 在线。
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentPipelineContext, DbChatTurn } from "@fambrain/agent-types";
import { listCorpusUserIds } from "@/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { hybridRecall } from "@/agentflow/agents/online/knowledge-manager/hybrid-recall";
import { getProfileRecallParams } from "@/agentflow/agents/online/knowledge-manager/km-config";
import { resolveQueryProfile } from "@/agentflow/agents/online/knowledge-manager/query-profile";
import { retrieveKnowledge } from "@/agentflow/agents/online/knowledge-manager/retrieve";
import { runPipelineStream } from "@/agentflow/index";
import { bootstrapAgentsRuntime } from "@/config";
import {
    assertKm,
    assertPipeline,
    type JsonAssert,
    type KmEvalSnapshot,
    type PipelineEvalSnapshot,
} from "./assert-golden";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, "golden.json");

type GoldenTier = "pipeline" | "km";

type GoldenCase = {
    id: string;
    tier: GoldenTier;
    label: string;
    question?: string;
    km?: {
        searchQuery: string;
        queryType: "identity" | "enumeration" | "tech" | "default";
        topics: string[];
        subTasks: string[];
    };
    assert: JsonAssert;
};

type CacheTurn = {
    question: string;
    assert: JsonAssert;
    expectCacheHit?: boolean;
};

type GoldenFile = {
    version: number;
    cases: GoldenCase[];
    cacheProbe?: {
        id: string;
        label: string;
        conversationIdPrefix: string;
        turns: CacheTurn[];
    };
};

type CaseResult = {
    id: string;
    tier: GoldenTier;
    label: string;
    pass: boolean;
    reason: string;
    latencyMs: number;
    coalesceViolation?: boolean;
    cacheHit?: boolean | null;
    cacheExpected?: boolean;
};

type EvalMetrics = {
    goldenPassRate: number;
    passed: number;
    total: number;
    coalesceFailureRate: number;
    coalesceChecks: number;
    coalesceFailures: number;
    cacheHitRate: number | null;
    cacheHits: number;
    cacheEligibleTurns: number;
    cacheNote: string;
    latencyMs: {
        avg: number;
        min: number;
        max: number;
        p95: number;
    };
};

type EvalReport = {
    generatedAt: string;
    corpusUserId: string;
    chromaUp: boolean;
    metrics: EvalMetrics;
    results: CaseResult[];
    cacheProbe?: CaseResult[];
};

const chromaUrl = (): string => {
    const base =
        process.env.CHROMA_SERVER_URL?.trim() ||
        `http://${process.env.CHROMA_HOST ?? "127.0.0.1"}:${process.env.CHROMA_PORT ?? "8030"}`;
    return base.replace(/\/$/, "");
};

const chromaReady = async (): Promise<boolean> => {
    try {
        const res = await fetch(`${chromaUrl()}/api/v2/heartbeat`, {
            signal: AbortSignal.timeout(3000),
        });
        return res.ok;
    } catch {
        return false;
    }
};

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv) return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) {
        throw new Error("无 corpus 用户；请设置 FAMBRAIN_CORPUS_USER_ID 或 index:corpus");
    }
    return ids[0]!;
};

const runPipelineCase = async (
    corpusUserId: string,
    question: string,
    conversationId: string
): Promise<PipelineEvalSnapshot> => {
    const started = Date.now();
    const steps: string[] = [];
    let answer = "";
    let error: string | undefined;
    let hitCount = 0;
    let coverage = "none";
    const history: DbChatTurn[] = [{ role: "user", content: question }];
    const context: AgentPipelineContext = {
        actorUserId: corpusUserId,
        corpusUserId,
        displayName: "Eval",
        conversationId,
    };
    const gen = runPipelineStream(history, context);
    while (true) {
        const next = await gen.next();
        if (next.done) {
            answer = next.value.answer;
            break;
        }
        const ev = next.value;
        if (ev.type === "step" && ev.status === "running") steps.push(ev.name);
        if (ev.type === "error") error = ev.message;
    }
    // 终态 hit/coverage 无法从 stream 直接取；用 answer 长度等断言即可
    return {
        steps,
        answer,
        error,
        hitCount,
        coverage,
        latencyMs: Date.now() - started,
        cacheHit: false,
    };
};

const runKmCase = async (
    corpusUserId: string,
    km: NonNullable<GoldenCase["km"]>
): Promise<KmEvalSnapshot> => {
    const started = Date.now();
    const queryProfile = resolveQueryProfile(
        km.searchQuery,
        km.subTasks,
        km.queryType
    );
    const { vectorTopK } = getProfileRecallParams(queryProfile);
    const vectorQuery = [km.searchQuery, ...km.topics, ...km.subTasks].join(
        " "
    );
    const sparseQuery = [km.searchQuery, ...km.subTasks].join(" ");

    const [result, hybrid] = await Promise.all([
        retrieveKnowledge({
            corpusUserId,
            searchQuery: km.searchQuery,
            topics: km.topics,
            subTasks: km.subTasks,
            queryType: km.queryType,
            candidates: [],
        }),
        hybridRecall(corpusUserId, vectorQuery, sparseQuery, vectorTopK),
    ]);

    return {
        hits: result.hits.map((h) => ({
            path: h.path,
            excerpt: h.excerpt,
            relevance: h.relevance,
        })),
        coverage: result.coverage,
        notes: result.notes,
        queryProfile,
        candidateCount: hybrid.candidates.length,
        recallSource: hybrid.recallSource,
        latencyMs: Date.now() - started,
    };
};

const evaluateCase = async (
    spec: GoldenCase,
    corpusUserId: string,
    runIndex: number
): Promise<CaseResult> => {
    const started = Date.now();
    if (spec.tier === "km") {
        if (!spec.km) {
            return {
                id: spec.id,
                tier: spec.tier,
                label: spec.label,
                pass: false,
                reason: "km 用例缺少 km 字段",
                latencyMs: 0,
            };
        }
        const snap = await runKmCase(corpusUserId, spec.km);
        const issues = assertKm(snap, spec.assert);
        const coalesceViolation =
            snap.candidateCount > 0 && snap.hits.length === 0;
        return {
            id: spec.id,
            tier: spec.tier,
            label: spec.label,
            pass: issues.length === 0,
            reason:
                issues.length === 0
                    ? `ok (${snap.recallSource}, candidates=${snap.candidateCount})`
                    : issues.join("; "),
            latencyMs: snap.latencyMs,
            coalesceViolation,
        };
    }

    const conversationId = `eval-${spec.id}-r${runIndex}-${Date.now()}`;
    const snap = await runPipelineCase(
        corpusUserId,
        spec.question ?? "",
        conversationId
    );
    const issues = assertPipeline(snap, spec.assert);
    return {
        id: spec.id,
        tier: spec.tier,
        label: spec.label,
        pass: issues.length === 0,
        reason: issues.length === 0 ? "ok" : issues.join("; "),
        latencyMs: snap.latencyMs || Date.now() - started,
    };
};

const runCacheProbe = async (
    probe: NonNullable<GoldenFile["cacheProbe"]>,
    corpusUserId: string
): Promise<CaseResult[]> => {
    const conversationId = `${probe.conversationIdPrefix}-${Date.now()}`;
    const out: CaseResult[] = [];
    for (const [i, turn] of probe.turns.entries()) {
        const snap = await runPipelineCase(
            corpusUserId,
            turn.question,
            conversationId
        );
        const issues = assertPipeline(snap, turn.assert);
        const cacheHit = snap.cacheHit ?? false;
        const allIssues = [...issues];
        out.push({
            id: `${probe.id}-t${i + 1}`,
            tier: "pipeline",
            label: `${probe.label} · turn${i + 1}`,
            pass: allIssues.length === 0,
            reason:
                allIssues.length === 0
                    ? turn.expectCacheHit
                        ? `ok（cache 探测：${cacheHit ? "hit" : "miss，cache 未接入"}）`
                        : "ok"
                    : allIssues.join("; "),
            latencyMs: snap.latencyMs,
            cacheHit,
            cacheExpected: turn.expectCacheHit ?? false,
        });
    }
    return out;
};

const percentile = (values: number[], p: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(
        sorted.length - 1,
        Math.ceil((p / 100) * sorted.length) - 1
    );
    return sorted[idx]!;
};

const buildMetrics = (
    results: CaseResult[],
    cacheProbe: CaseResult[]
): EvalMetrics => {
    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    const kmResults = results.filter((r) => r.tier === "km");
    const coalesceChecks = kmResults.length;
    const coalesceFailures = kmResults.filter((r) => r.coalesceViolation).length;
    const latencies = results.map((r) => r.latencyMs);

    const cacheEligible = cacheProbe.filter((r) => r.cacheExpected);
    const cacheHits = cacheEligible.filter((r) => r.cacheHit === true).length;

    return {
        goldenPassRate: total === 0 ? 0 : passed / total,
        passed,
        total,
        coalesceFailureRate:
            coalesceChecks === 0 ? 0 : coalesceFailures / coalesceChecks,
        coalesceChecks,
        coalesceFailures,
        cacheHitRate:
            cacheEligible.length === 0
                ? null
                : cacheHits / cacheEligible.length,
        cacheHits,
        cacheEligibleTurns: cacheEligible.length,
        cacheNote:
            cacheEligible.length === 0
                ? "无 cache 探测用例"
                : cacheHits === 0
                  ? "检索 cache 尚未接入 pipeline（指标占位 0/N）"
                  : "cache 已命中",
        latencyMs: {
            avg:
                latencies.length === 0
                    ? 0
                    : latencies.reduce((a, b) => a + b, 0) / latencies.length,
            min: latencies.length === 0 ? 0 : Math.min(...latencies),
            max: latencies.length === 0 ? 0 : Math.max(...latencies),
            p95: percentile(latencies, 95),
        },
    };
};

const formatMarkdown = (report: EvalReport): string => {
    const m = report.metrics;
    const lines: string[] = [
        `# Eval 报告`,
        ``,
        `- 时间：${report.generatedAt}`,
        `- corpusUserId：${report.corpusUserId}`,
        `- Chroma：${report.chromaUp ? "在线" : "离线"}`,
        ``,
        `## 指标（4 项 MVP）`,
        ``,
        `| 指标 | 值 |`,
        `|------|-----|`,
        `| Golden 通过率 | **${m.passed}/${m.total}** (${(m.goldenPassRate * 100).toFixed(1)}%) |`,
        `| candidates>0 但 hits=0 | **${m.coalesceFailures}/${m.coalesceChecks}** (${(m.coalesceFailureRate * 100).toFixed(1)}%) |`,
        `| cache 命中率 | ${m.cacheHitRate === null ? "N/A" : `${m.cacheHits}/${m.cacheEligibleTurns} (${(m.cacheHitRate * 100).toFixed(1)}%)`} |`,
        `| 端到端 latency p95 | **${Math.round(m.latencyMs.p95)}ms** (avg ${Math.round(m.latencyMs.avg)}ms) |`,
        ``,
        `> cache：${m.cacheNote}`,
        ``,
        `## 用例`,
        ``,
        `| ID | 层 | 结果 | latency | 说明 |`,
        `|----|-----|------|---------|------|`,
    ];
    for (const r of report.results) {
        lines.push(
            `| ${r.id} | ${r.tier} | ${r.pass ? "✅" : "❌"} | ${r.latencyMs}ms | ${r.reason.replace(/\|/g, "\\|")} |`
        );
    }
    if (report.cacheProbe?.length) {
        lines.push(``, `## Cache 探测`, ``);
        for (const r of report.cacheProbe) {
            lines.push(
                `- ${r.id}: ${r.pass ? "✅" : "⚠️"} ${r.reason} (${r.latencyMs}ms)`
            );
        }
    }
    return lines.join("\n");
};

const jsonOnly = process.argv.includes("--json-only");

const main = async (): Promise<void> => {
    bootstrapAgentsRuntime();
    const raw = await readFile(GOLDEN_PATH, "utf8");
    const golden = JSON.parse(raw) as GoldenFile;
    const corpusUserId = await resolveCorpusUserId();
    const chromaUp = await chromaReady();

    console.log(`eval:run — ${golden.cases.length} cases + cache probe`);
    console.log(`corpusUserId=${corpusUserId} chroma=${chromaUp ? "up" : "down"}\n`);

    const results: CaseResult[] = [];
    for (const [i, spec] of golden.cases.entries()) {
        process.stdout.write(`  [${i + 1}/${golden.cases.length}] ${spec.id} … `);
        const result = await evaluateCase(spec, corpusUserId, 1);
        console.log(result.pass ? "PASS" : "FAIL");
        results.push(result);
    }

    const cacheProbe = golden.cacheProbe
        ? await runCacheProbe(golden.cacheProbe, corpusUserId)
        : [];

    const report: EvalReport = {
        generatedAt: new Date().toISOString(),
        corpusUserId,
        chromaUp,
        metrics: buildMetrics(results, cacheProbe),
        results,
        cacheProbe: cacheProbe.length ? cacheProbe : undefined,
    };

    if (process.env.EVAL_WRITE_REPORT === "1") {
        const repoRoot = path.resolve(__dirname, "../../../..");
        const dir = path.join(repoRoot, "data/eval/reports");
        await mkdir(dir, { recursive: true });
        const stamp = report.generatedAt.replace(/[:.]/g, "-");
        const jsonPath = path.join(dir, `eval-${stamp}.json`);
        const mdPath = path.join(dir, `eval-${stamp}.md`);
        await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
        await writeFile(mdPath, formatMarkdown(report), "utf8");
        console.log(`\n报告已写入:\n  ${jsonPath}\n  ${mdPath}`);
    }

    if (!jsonOnly) {
        console.log("\n" + formatMarkdown(report));
    } else {
        console.log(JSON.stringify(report, null, 2));
    }

    const failed = results.filter((r) => !r.pass);
    const coalesceBad = report.metrics.coalesceFailures > 0;
    if (failed.length > 0 || coalesceBad) {
        process.exit(1);
    }
    console.log("\nEval MVP 通过。");
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
