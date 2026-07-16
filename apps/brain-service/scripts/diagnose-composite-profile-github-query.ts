/**
 * 诊断：综合问「年龄 + 姓名 + 全部项目 + 开源 GitHub/线上地址」全链路。
 *
 *   pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-composite-profile-github-query.ts
 */
process.env.REPEAT_QUESTION_CACHE_DISABLED = "1";
process.env.RETRIEVAL_CACHE_DISABLED = "1";
process.env.COMPOSITE_ANSWER_CACHE_DISABLED = "1";

import type { AgentPipelineContext, DbChatTurn } from "@fambrain/brain-types";
import { listCorpusUserIds } from "@/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { runPipelineStream } from "@/agentflow/index";
import {
    completeIntakeCoordinator,
    runIntakePipeline,
} from "@/agentflow/agents/online/intake-coordinator";
import { bootstrapBrainServiceRuntime } from "@/config";

const USER_QUESTION =
    "我今年多大了？ 叫什么？帮我列出 所有我做过的项目，并且告诉我 其中开源项目的githup地址跟线上地址";

bootstrapBrainServiceRuntime();

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv) return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) throw new Error("无 corpus 用户，请先 index:corpus");
    return ids[0]!;
};

const corpusUserId = await resolveCorpusUserId();
console.log("diagnose-composite-profile-github-query");
console.log("corpusUserId:", corpusUserId);
console.log("question:", USER_QUESTION);
console.log("");

console.log("— 1. Intake LLM + guard 链 —");
const history: DbChatTurn[] = [{ role: "user", content: USER_QUESTION }];
const intakeRaw = await completeIntakeCoordinator(history);
const { decision, earlyExit } = await runIntakePipeline({
    intakeRaw,
    userQuestion: USER_QUESTION,
    intakeHistory: history,
    session: { conversationId: "diag-composite", corpusUserId },
});

console.log("  intent:", decision.intent);
console.log("  earlyExit:", earlyExit);
console.log("  routeMode:", decision.routeMode);
console.log("  composeMode:", decision.composeMode);
console.log("  routeReason:", decision.routeReason);
const pp = decision.pathPlan;
if (pp) {
    console.log("  pathPlan:", {
        km: pp.km.map((s) => `${s.id}:${s.label}(${s.queryType})`),
        list: pp.list.map((s) => `${s.id}:${s.label}`),
        tool: pp.tool.map((s) => `${s.id}:${s.toolId}`),
        dag: pp.dag.map((s) => `${s.id}:${s.template}`),
    });
}
console.log("  compositeSlots:", (decision.compositeSlots ?? []).length);
for (const slot of decision.compositeSlots ?? []) {
    console.log(
        `    - ${slot.id} | ${slot.queryType} | ${slot.label} | executor=${slot.executor ?? "km_retrieve"}`
    );
}
console.log("  retrievalPlan labels:", (decision.retrievalPlan ?? []).map((p) => p.label));

console.log("\n— 2. 全链路 pipeline —");
const steps: string[] = [];
let answer = "";
let error: string | undefined;
let pipelineMeta: Record<string, unknown> = {};

const context: AgentPipelineContext = {
    actorUserId: corpusUserId,
    corpusUserId,
    displayName: "diagnose",
    conversationId: `diag-${Date.now()}`,
};

const gen = runPipelineStream(history, context);
while (true) {
    const next = await gen.next();
    if (next.done) {
        answer = next.value.answer;
        pipelineMeta = {
            intent: next.value.intent,
            composeMode: next.value.composeMode,
            pathPlanCounts: next.value.pathPlanCounts,
            hitCount: next.value.hitCount,
            coverage: next.value.coverage,
            totalMs: next.value.totalMs,
            error: next.value.error,
        };
        break;
    }
    const ev = next.value;
    if (ev.type === "step" && ev.status === "running") steps.push(ev.name);
    if (ev.type === "error") error = ev.message;
}

console.log("  steps:", steps.join(" → "));
console.log("  pipeline meta:", JSON.stringify(pipelineMeta, null, 2));
if (error) console.log("  stream error:", error);

console.log("\n— 3. 答案摘要 —");
console.log("  length:", answer.length);
console.log("  preview:\n", answer.slice(0, 1200), answer.length > 1200 ? "\n…" : "");

const checks: { name: string; ok: boolean; detail: string }[] = [
    {
        name: "未早退/未 clarify",
        ok: !earlyExit && decision.intent === "retrieve_and_answer",
        detail: `intent=${decision.intent} earlyExit=${earlyExit}`,
    },
    {
        name: "composeMode=composite",
        ok: decision.composeMode === "composite" || (decision.compositeSlots?.length ?? 0) >= 2,
        detail: `composeMode=${decision.composeMode} slots=${decision.compositeSlots?.length}`,
    },
    {
        name: "含 plan_executor 步骤",
        ok: steps.includes("plan_executor"),
        detail: steps.join(","),
    },
    {
        name: "含 analyst 步骤",
        ok: steps.includes("analyst"),
        detail: steps.join(","),
    },
    {
        name: "姓名（潘展飞）",
        ok: /潘展飞/.test(answer),
        detail: answer.slice(0, 80),
    },
    {
        name: "年龄（岁 或 1993）",
        ok: /\d+\s*岁|1993/.test(answer),
        detail: answer.slice(0, 120),
    },
    {
        name: "项目段（序号或项目名）",
        ok: /项目|agents-monorepo|Sentinel|release-bot|\d+[\.、]/.test(answer),
        detail: "—",
    },
    {
        name: "GitHub URL",
        ok: /github\.com/i.test(answer),
        detail: (answer.match(/https?:\/\/[^\s)]+github[^\s)]+/gi) ?? []).join(" | "),
    },
    {
        name: "含 enumeration + external_link 槽（顺序随 Intake）",
        ok:
            (decision.compositeSlots ?? []).some((s) => s.queryType === "enumeration") &&
            (decision.compositeSlots ?? []).some((s) => s.queryType === "external_link"),
        detail: JSON.stringify(
            (decision.compositeSlots ?? []).map((s) => s.queryType)
        ),
    },
    {
        name: "回答顺序：年龄/姓名在项目段之前",
        ok: (() => {
            const age = answer.search(/岁|1993/);
            const name = answer.search(/潘展飞/);
            const proj = answer.search(/项目|agents-monorepo|城市管理/);
            if (age < 0 || name < 0 || proj < 0) return false;
            return Math.min(age, name) < proj;
        })(),
        detail: "expect identity sections before project list",
    },
    {
        name: "外链标题非简历文件名",
        ok:
            /github\.com/i.test(answer) &&
            !/^\d+\.\s*个人简历/m.test(answer) &&
            /(sentinel|release-bot|pzfnqbn)/i.test(answer),
        detail: answer.match(/\d+\.\s*[^\n]+/g)?.slice(-4).join(" | ") ?? "—",
    },
];

console.log("\n— 4. 断言 —");
let failed = 0;
for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    console.log(`  ${mark} ${c.name}${c.ok ? "" : ` — ${c.detail}`}`);
    if (!c.ok) failed++;
}

if (failed > 0) {
    console.log(`\nFAILED (${failed}/${checks.length} checks)`);
    process.exit(1);
}
console.log(`\nOK (${checks.length}/${checks.length})`);
