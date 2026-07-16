/**
 * 诊断：超长复合问（工龄/任职/近况/技术栈/年龄姓名/全量项目/开源链接）。
 *
 *   pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-long-composite-career-query.ts
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
    "你在IT行业干了多少年了？都在哪几家公司上过班，职位是什么？这两年在干什么？做过哪些项目（近两年）？主要技术栈是什么？我今年多大了？叫什么？帮我列出所有我做过的项目，并且告诉我其中开源项目的github地址跟线上地址";

bootstrapBrainServiceRuntime();

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv) return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) throw new Error("无 corpus 用户");
    return ids[0]!;
};

const corpusUserId = await resolveCorpusUserId();
console.log("diagnose-long-composite-career-query");
console.log("corpusUserId:", corpusUserId);
console.log("question:", USER_QUESTION);
console.log("");

console.log("— 1. Intake —");
const history: DbChatTurn[] = [{ role: "user", content: USER_QUESTION }];
const intakeRaw = await completeIntakeCoordinator(history);
const { decision, earlyExit } = await runIntakePipeline({
    intakeRaw,
    userQuestion: USER_QUESTION,
    intakeHistory: history,
    session: { conversationId: "diag-long-career", corpusUserId },
});

console.log("  intent:", decision.intent, "earlyExit:", earlyExit);
console.log("  composeMode:", decision.composeMode);
console.log("  subTasks:", decision.subTasks);
console.log("  retrievalPlan:");
for (const p of decision.retrievalPlan ?? []) {
    console.log(
        `    - ${p.queryType}/${p.identityField ?? "-"}/${p.enumerationControl?.listKind ?? "-"}${
            p.enumerationControl?.timeWindowYears
                ? `/y${p.enumerationControl.timeWindowYears}`
                : ""
        } | ${p.label}`
    );
}
console.log("  compositeSlots:");
for (const s of decision.compositeSlots ?? []) {
    console.log(
        `    - ${s.id} | ${s.queryType} | field=${s.identityField ?? "-"} | exec=${s.executor ?? "km"} | tw=${s.enumerationControl?.timeWindowYears ?? "-"} | ${s.label}`
    );
}

console.log("\n— 2. Pipeline —");
const context: AgentPipelineContext = {
    actorUserId: corpusUserId,
    corpusUserId,
    displayName: "diagnose",
    conversationId: `diag-long-${Date.now()}`,
};
let answer = "";
const gen = runPipelineStream(history, context);
while (true) {
    const next = await gen.next();
    if (next.done) {
        answer = next.value.answer;
        break;
    }
}

console.log("  answer length:", answer.length);
console.log("  preview:\n", answer.slice(0, 1600), answer.length > 1600 ? "\n…" : "");

const slots = decision.compositeSlots ?? [];
const experienceSlots = slots.filter(
    (s) => s.enumerationControl?.listKind === "experience"
);
const experienceWithTw = experienceSlots.filter(
    (s) => (s.enumerationControl?.timeWindowYears ?? 0) > 0
);
const experienceFull = experienceSlots.filter(
    (s) => !(s.enumerationControl?.timeWindowYears)
);
const projectSlots = slots.filter(
    (s) => s.enumerationControl?.listKind === "project"
);
const projectWithTw = projectSlots.filter(
    (s) => (s.enumerationControl?.timeWindowYears ?? 0) > 0
);
const projectFull = projectSlots.filter(
    (s) => !(s.enumerationControl?.timeWindowYears)
);

const paginationContradiction = [
    ...answer.matchAll(
        /语料共\s*(\d+)\s*个项目[\s\S]{0,160}?序号\s+\d+[–-](\d+)[\s\S]{0,60}?已全部列出/g
    ),
].some((m) => Number(m[2]) < Number(m[1]));

const checks: { name: string; ok: boolean; detail: string }[] = [
    {
        name: "未早退",
        ok: !earlyExit && decision.intent === "retrieve_and_answer",
        detail: String(decision.intent),
    },
    {
        name: "含 tenure 槽（年限走 compute，非口语猜）",
        ok: slots.some((s) => s.identityField === "tenure"),
        detail: slots.map((s) => s.identityField ?? s.queryType).join(","),
    },
    {
        name: "experience 槽：全量≤1 且近两年≤1（公司+职位须合并）",
        ok:
            experienceFull.length <= 1 &&
            experienceWithTw.length <= 1 &&
            experienceSlots.length <= 2,
        detail: experienceSlots
            .map(
                (s) =>
                    `${s.label}:y${s.enumerationControl?.timeWindowYears ?? "-"}`
            )
            .join("|") || "0",
    },
    {
        name: "project 槽：全量≤1 且近两年≤1",
        ok:
            projectFull.length <= 1 &&
            projectWithTw.length <= 1 &&
            projectSlots.length <= 2,
        detail: projectSlots
            .map(
                (s) =>
                    `${s.label}:y${s.enumerationControl?.timeWindowYears ?? "-"}`
            )
            .join("|"),
    },
    {
        name: "含 external_link",
        ok: slots.some((s) => s.queryType === "external_link"),
        detail: "—",
    },
    {
        name: "姓名 潘展飞",
        ok: /潘展飞/.test(answer),
        detail: "—",
    },
    {
        name: "年龄含岁或1993",
        ok: /\d+\s*岁|1993/.test(answer),
        detail: "—",
    },
    {
        name: "从业年限含2016起点（非仅奥卡云3年）",
        ok:
            /简历工作经历最早自\s*2016|最早自\s*2016/.test(answer) ||
            (/从业年限[\s\S]{0,80}2016/.test(answer) &&
                !/约\s*3\s*年\s*3\s*个?月/.test(answer)),
        detail: (answer.match(
            /[^\n]*(?:从业|最早自|2016|工作经历最早)[^\n]*/g
        ) ?? [])
            .slice(0, 4)
            .join(" | "),
    },
    {
        name: "任职含奥卡云以外公司（奖多多/友谊/云联）",
        ok: /奖多多|友谊时光|云联智慧/.test(answer),
        detail: "—",
    },
    {
        name: "任职含职位（组长/主管/全栈）",
        ok: /前端小组组长|前端主管|全栈开发/.test(answer),
        detail: (answer.match(/[^\n]*(?:组长|主管|全栈)[^\n]*/g) ?? [])
            .slice(0, 3)
            .join(" | "),
    },
    {
        name: "全量项目非仅4条摘要",
        ok:
            /语料共\s*\d+|共\s*\d+\s*个项目|第\s*1\//.test(answer) ||
            (answer.match(/^\d+\.\s+\*\*/gm) ?? []).length >= 10,
        detail: `numbered=${(answer.match(/^\d+\.\s+\*\*/gm) ?? []).length}`,
    },
    {
        name: "分页文案不自相矛盾（已全部列出却未列完）",
        ok: !paginationContradiction,
        detail: paginationContradiction ? "shown<total + 已全部列出" : "—",
    },
    {
        name: "GitHub URL",
        ok: /github\.com/i.test(answer),
        detail: "—",
    },
];

console.log("\n— 3. 断言 —");
let failed = 0;
for (const c of checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.ok ? "" : ` — ${c.detail}`}`);
    if (!c.ok) failed++;
}
if (failed > 0) {
    console.log(`\nFAILED (${failed}/${checks.length})`);
    process.exit(1);
}
console.log(`\nOK (${checks.length}/${checks.length})`);
