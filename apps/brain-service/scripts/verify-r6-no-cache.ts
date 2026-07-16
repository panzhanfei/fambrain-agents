/**
 * R6-1 / R6-3 / P0-15 / R6-2 全链路验收（同问短路 + 检索结果 + composite 终稿 cache 全关）。
 *
 *   pnpm --filter @fambrain/brain-service run verify:r6-no-cache
 *
 * 需 Ollama + Chroma + 语料（潘展飞 4 段经历）。
 */
process.env.REPEAT_QUESTION_CACHE_DISABLED = "1";
process.env.RETRIEVAL_CACHE_DISABLED = "1";
process.env.COMPOSITE_ANSWER_CACHE_DISABLED = "1";

import type { AgentPipelineContext, DbChatTurn } from "@fambrain/brain-types";
import {
    clearMemoryCompositeAnswerCache,
    clearMemoryRetrievalCache,
    resetInfraConfigForTests,
} from "@fambrain/infra";
import { listCorpusUserIds } from "@/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { runPipelineStream } from "@/agentflow/index";
import { bootstrapBrainServiceRuntime } from "@/config";
import {
    assertPipeline,
    type JsonAssert,
    type PipelineEvalSnapshot,
} from "./eval/assert-golden";

const COMPANIES = ["云联智慧", "友谊时光", "奖多多", "奥卡云"] as const;
const BAD_NAMES = /赵一|陈明|秦汉新城|大表哥/;
const DENY_ALL = /没有明确列出|未在知识库找到|知识库未覆盖|无法据此/;

resetInfraConfigForTests();
clearMemoryRetrievalCache();
clearMemoryCompositeAnswerCache();
bootstrapBrainServiceRuntime();

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv) return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) throw new Error("无 corpus 用户");
    return ids[0]!;
};

const runTurn = async (input: {
    corpusUserId: string;
    conversationId: string;
    question: string;
    priorHistory?: DbChatTurn[];
}): Promise<PipelineEvalSnapshot> => {
    const started = Date.now();
    const steps: string[] = [];
    let answer = "";
    let error: string | undefined;
    let cacheHit = false;
    let repeatHit = false;
    const history: DbChatTurn[] = [
        ...(input.priorHistory ?? []),
        { role: "user", content: input.question },
    ];
    const context: AgentPipelineContext = {
        actorUserId: input.corpusUserId,
        corpusUserId: input.corpusUserId,
        displayName: "R6-verify",
        conversationId: input.conversationId,
    };
    const gen = runPipelineStream(history, context);
    while (true) {
        const next = await gen.next();
        if (next.done) {
            answer = next.value.answer;
            if (next.value.retrievalCacheHit) cacheHit = true;
            if (next.value.repeatQuestionHit) repeatHit = true;
            break;
        }
        const ev = next.value;
        if (ev.type === "step" && ev.status === "running") steps.push(ev.name);
        if (ev.type === "error") error = ev.message;
        if (ev.type === "retrieval_meta" && ev.cacheHit) cacheHit = true;
    }
    return {
        steps,
        answer,
        error,
        hitCount: 0,
        coverage: "none",
        latencyMs: Date.now() - started,
        cacheHit,
        repeatHit,
    };
};

const companyHits = (answer: string): string[] =>
    COMPANIES.filter((c) => answer.includes(c));

type ScenarioResult = {
    id: string;
    label: string;
    pass: boolean;
    reason: string;
    latencyMs: number;
    answerPreview: string;
};

const check = (
    id: string,
    label: string,
    snap: PipelineEvalSnapshot,
    extra: string[] = [],
    assert?: JsonAssert
): ScenarioResult => {
    const issues = [
        ...(assert ? assertPipeline(snap, assert) : []),
        ...extra,
    ];
    if (snap.cacheHit) issues.push("unexpected cacheHit（cache 应已关闭）");
    if (snap.repeatHit) issues.push("unexpected repeatHit（同问短路应已关闭）");
    return {
        id,
        label,
        pass: issues.length === 0,
        reason: issues.length === 0 ? "ok" : issues.join("; "),
        latencyMs: snap.latencyMs,
        answerPreview:
            snap.answer.length > 280
                ? `${snap.answer.slice(0, 280)}…`
                : snap.answer,
    };
};

const runR61 = async (corpusUserId: string): Promise<ScenarioResult[]> => {
    const conv = `r6-1-${Date.now()}`;
    const q = "我在那几家公司上过班？";
    let history: DbChatTurn[] = [];
    const t1 = await runTurn({ corpusUserId, conversationId: conv, question: q });
    const r1 = check("R6-1-t1", "同问枚举 · 首轮", t1, [], {
        mustIncludeSteps: ["retrieval", "analyst"],
        answerMustIncludeAll: [...COMPANIES],
    });
    history = [
        { role: "user", content: q },
        { role: "assistant", content: t1.answer },
    ];
    const t2 = await runTurn({
        corpusUserId,
        conversationId: conv,
        question: q,
        priorHistory: history,
    });
    const c1 = companyHits(t1.answer);
    const c2 = companyHits(t2.answer);
    const extra: string[] = [];
    if (c2.length < c1.length) {
        extra.push(`同句再问公司数减少 ${c1.length}→${c2.length}（${c1.join("、")} vs ${c2.join("、")}）`);
    }
    const r2 = check("R6-1-t2", "同问枚举 · 同句再问", t2, extra, {
        mustIncludeSteps: ["retrieval", "analyst"],
        answerMustIncludeAll: [...COMPANIES],
    });
    return [r1, r2];
};

const runP015 = async (corpusUserId: string): Promise<ScenarioResult[]> => {
    const q =
        "我叫什么，我做过什么项目，我在那几家公司上过班，从事什么行业？什么学历？";
    const out: ScenarioResult[] = [];
    for (let i = 0; i < 3; i++) {
        const snap = await runTurn({
            corpusUserId,
            conversationId: `p0-15-${Date.now()}-${i}`,
            question: q,
        });
        const extra: string[] = [];
        if (!snap.answer.includes("潘展飞")) extra.push("answer 缺少「潘展飞」");
        if (BAD_NAMES.test(snap.answer)) {
            extra.push(`answer 含幻觉人名/地点: ${snap.answer.match(BAD_NAMES)?.[0]}`);
        }
        out.push(
            check(`P0-15-run${i + 1}`, `综合履历 · 第 ${i + 1} 遍`, snap, extra, {
                mustIncludeSteps: ["retrieval", "analyst"],
            })
        );
    }
    return out;
};

const runR63 = async (corpusUserId: string): Promise<ScenarioResult[]> => {
    const conv = `r6-3-${Date.now()}`;
    const turns: Array<{ id: string; label: string; q: string; assert: JsonAssert }> =
        [
            {
                id: "R6-3-t1",
                label: "综合履历首轮",
                q: "我叫什么，我做过什么项目，我在那几家公司上过班，近两年在干什么？",
                assert: {
                    mustIncludeSteps: ["retrieval", "analyst"],
                    answerRe: "潘展飞",
                    answerMustIncludeAll: [...COMPANIES],
                },
            },
            {
                id: "R6-3-t2",
                label: "综合履历同句再问（无同问短路）",
                q: "我叫什么，我做过什么项目，我在那几家公司上过班，近两年在干什么？",
                assert: {
                    mustIncludeSteps: ["retrieval", "analyst"],
                    answerMustIncludeAll: [...COMPANIES],
                },
            },
            {
                id: "R6-3-t3",
                label: "单问公司枚举",
                q: "我在哪几家公司上过班？",
                assert: {
                    mustIncludeSteps: ["retrieval", "analyst"],
                    answerMustIncludeAll: [...COMPANIES],
                },
            },
            {
                id: "R6-3-t4",
                label: "编号子问「1. 公司在哪」",
                q: "1. 我在哪几家公司上过班？",
                assert: {
                    mustIncludeSteps: ["retrieval", "analyst"],
                    answerMustIncludeAll: [...COMPANIES],
                },
            },
        ];
    let history: DbChatTurn[] = [];
    const out: ScenarioResult[] = [];
    for (const turn of turns) {
        const snap = await runTurn({
            corpusUserId,
            conversationId: conv,
            question: turn.q,
            priorHistory: history,
        });
        out.push(check(turn.id, turn.label, snap, [], turn.assert));
        history = [
            ...history,
            { role: "user", content: turn.q },
            { role: "assistant", content: snap.answer },
        ];
    }
    return out;
};

const runR62 = async (corpusUserId: string): Promise<ScenarioResult[]> => {
    const conv = `r6-2-${Date.now()}`;
    const q1 = "我在那几家公司上过班？";
    const t1 = await runTurn({ corpusUserId, conversationId: conv, question: q1 });
    const r1 = check("R6-2-t1", "工作经历首轮", t1, [], {
        mustIncludeSteps: ["retrieval", "analyst"],
        answerRe: "奥卡云",
    });
    const history: DbChatTurn[] = [
        { role: "user", content: q1 },
        { role: "assistant", content: t1.answer },
    ];
    const q2 =
        "我在那几家公司上过班？用表格给我列出来 时间 职位 公司名称";
    const t2 = await runTurn({
        corpusUserId,
        conversationId: conv,
        question: q2,
        priorHistory: history,
    });
    const extra: string[] = [];
    if (!t2.answer.includes("奥卡云")) {
        extra.push("追问表格后 answer 丢失「奥卡云」（跨轮失忆）");
    }
    if (DENY_ALL.test(t2.answer)) {
        extra.push("追问表格出现全盘否定表述");
    }
    const r2 = check("R6-2-t2", "表格追问", t2, extra, {
        mustIncludeSteps: ["retrieval", "analyst"],
    });
    return [r1, r2];
};

const main = async () => {
    const corpusUserId = await resolveCorpusUserId();
    console.log("verify-r6-no-cache");
    console.log(`  corpusUserId: ${corpusUserId}`);
    console.log(
        "  cache: repeat/retrieval/composite OFF (REPEAT/RETRIEVAL/COMPOSITE_ANSWER *_DISABLED=1)\n"
    );

    const sections: Array<{ title: string; results: ScenarioResult[] }> = [
        { title: "R6-1 工作经历枚举 + 同句再问", results: await runR61(corpusUserId) },
        { title: "P0-15 综合履历 ×3（独立会话）", results: await runP015(corpusUserId) },
        { title: "R6-3 同会话综合 → 编号子问", results: await runR63(corpusUserId) },
        { title: "R6-2 表格追问不失忆", results: await runR62(corpusUserId) },
    ];

    let failed = 0;
    let passed = 0;
    for (const sec of sections) {
        console.log(`— ${sec.title} —`);
        for (const r of sec.results) {
            const mark = r.pass ? "✓" : "✗";
            console.log(`  ${mark} ${r.id}: ${r.label} (${r.latencyMs}ms)`);
            if (!r.pass) console.log(`      ${r.reason}`);
            console.log(`      ${r.answerPreview.replace(/\n/g, " ").slice(0, 200)}`);
            if (r.pass) passed++;
            else failed++;
        }
        console.log();
    }

    console.log(`合计: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 项`);
    if (failed > 0) process.exit(1);
    console.log("\nOK");
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
