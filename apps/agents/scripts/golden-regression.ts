/**
 * Golden G1～G5：在线 Agent 全链路标准回归（最终验收用）。
 *
 * 覆盖 Intake → KM → FactChecker → ContentOrganizer → Analyst；
 * 用固定问法 + steps/answer 断言建立基线，填坑前后对比通过率。
 *
 *   pnpm run golden:regression
 *
 * 需 Ollama + Chroma + 已入库语料；corpusUserId 见 FAMBRAIN_CORPUS_USER_ID
 * 或 data/doc/users/ 下首个有 corpus 的用户。
 */
import type { AgentPipelineContext, DbChatTurn } from "@fambrain/agent-types";
import { listCorpusUserIds } from "@/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { runPipelineStream } from "@/agentflow/index";
import { bootstrapAgentsRuntime } from "@/config";

type GoldenId = "G1" | "G2" | "G3" | "G4" | "G5";

type PipelineCaseResult = {
    id: GoldenId;
    label: string;
    question: string;
    steps: string[];
    answer: string;
    error?: string;
    latencyMs: number;
    pass: boolean;
    reason: string;
};

type GoldenCase = {
    id: GoldenId;
    label: string;
    question: string;
    assert: (result: Omit<PipelineCaseResult, "id" | "label" | "question" | "pass" | "reason">) => string | null;
};

const CLARIFY_ANSWER = /哪|哪个|请说明|指的是|哪一段|哪一家|什么项目|能否说明/;

const hasStep = (steps: string[], name: string): boolean => steps.includes(name);

const hasRetrievalChain = (steps: string[]): boolean => hasStep(steps, "retrieval")
    && hasStep(steps, "fact_checker")
    && hasStep(steps, "content_organizer")
    && hasStep(steps, "analyst");

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv)
        return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) {
        throw new Error("无可用语料用户：请设置 FAMBRAIN_CORPUS_USER_ID，或先 pnpm run index:corpus");
    }
    return ids[0]!;
};

const buildContext = (corpusUserId: string, caseId: GoldenId): AgentPipelineContext => ({
    actorUserId: corpusUserId,
    corpusUserId,
    displayName: "Golden 回归",
    conversationId: `golden-${caseId}-${Date.now()}`,
});

const runPipelineCase = async (corpusUserId: string, spec: GoldenCase): Promise<PipelineCaseResult> => {
    const started = Date.now();
    const steps: string[] = [];
    let answer = "";
    let error: string | undefined;
    const history: DbChatTurn[] = [{ role: "user", content: spec.question }];
    const gen = runPipelineStream(history, buildContext(corpusUserId, spec.id));
    while (true) {
        const next = await gen.next();
        if (next.done) {
            answer = next.value.answer;
            break;
        }
        const ev = next.value;
        if (ev.type === "step" && ev.status === "running")
            steps.push(ev.name);
        if (ev.type === "error")
            error = ev.message;
    }
    const latencyMs = Date.now() - started;
    const base = { steps, answer, error, latencyMs };
    const failReason = spec.assert(base);
    return {
        id: spec.id,
        label: spec.label,
        question: spec.question,
        ...base,
        pass: failReason === null && !error,
        reason: error ? `pipeline error: ${error}` : (failReason ?? "ok"),
    };
};

/** 问法与期望见 docs/03-roadmap.md · Golden 问法（回归） */
const GOLDEN_CASES: GoldenCase[] = [
    {
        id: "G1",
        label: "闲聊不检索",
        question: "你好",
        assert: ({ steps, answer }) => {
            if (hasStep(steps, "retrieval") || hasStep(steps, "fact_checker"))
                return "不应进入 retrieval / fact_checker";
            if (!answer.trim())
                return "answer 为空";
            return null;
        },
    },
    {
        id: "G2",
        label: "姓名检索",
        question: "我的名字",
        assert: ({ steps, answer }) => {
            if (!hasStep(steps, "retrieval"))
                return "应进入 retrieval（非 clarify 短路）";
            if (!hasStep(steps, "analyst") && CLARIFY_ANSWER.test(answer))
                return "不应 clarify，应检索 personal/简历";
            if (!answer.trim())
                return "answer 为空";
            return null;
        },
    },
    {
        id: "G3",
        label: "项目与技术",
        question: "我做过的项目和掌握的技术",
        assert: ({ steps, answer }) => {
            if (!hasStep(steps, "retrieval"))
                return "应进入 retrieval";
            if (!hasStep(steps, "analyst"))
                return "应进入 analyst 写终稿";
            if (answer.trim().length < 60)
                return "回答过短，应有分点或段落";
            return null;
        },
    },
    {
        id: "G4",
        label: "城管平台技术",
        question: "城管平台用了什么技术",
        assert: ({ steps, answer }) => {
            if (!hasRetrievalChain(steps))
                return "应走 intake → retrieval → fact_checker → content_organizer → analyst";
            if (!/城管|城市管理平台/.test(answer))
                return "answer 应提及城管/城市管理平台相关内容";
            return null;
        },
    },
    {
        id: "G5",
        label: "无上下文 clarify",
        question: "那个项目呢？",
        assert: ({ steps, answer }) => {
            if (hasStep(steps, "analyst"))
                return "无上下文时不应进入 analyst 编造";
            if (!hasStep(steps, "intake"))
                return "应至少经过 intake";
            if (!CLARIFY_ANSWER.test(answer))
                return "answer 应像澄清问句（含「哪/哪个/指的是」等）";
            return null;
        },
    },
];

const printCase = (result: PipelineCaseResult): void => {
    const status = result.pass ? "PASS" : "FAIL";
    console.log(`\n=== ${result.id} ${result.label} [${status}] ===`);
    console.log(`问：${result.question}`);
    console.log(`steps: ${result.steps.join(" → ") || "(无)"}`);
    console.log(`耗时: ${result.latencyMs}ms`);
    if (result.error)
        console.log(`error: ${result.error}`);
    if (!result.pass)
        console.log(`原因: ${result.reason}`);
    const preview = result.answer.slice(0, 240);
    console.log(`答：${preview}${result.answer.length > 240 ? "…" : ""}`);
};

const printSummary = (results: PipelineCaseResult[]): void => {
    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    console.log("\n--- Golden 汇总 ---");
    for (const r of results) {
        console.log(`${r.id}: ${r.pass ? "✓" : "✗"}  ${r.reason}`);
    }
    console.log(`\n通过率: ${passed}/${total}（目标 ≥4/5）`);
};

const main = async (): Promise<void> => {
    bootstrapAgentsRuntime();
    const corpusUserId = await resolveCorpusUserId();
    console.log(`Golden G1～G5 全链路回归（corpusUserId=${corpusUserId}）\n`);
    const results: PipelineCaseResult[] = [];
    for (const spec of GOLDEN_CASES) {
        const result = await runPipelineCase(corpusUserId, spec);
        printCase(result);
        results.push(result);
    }
    printSummary(results);
    if (results.some((r) => !r.pass))
        process.exit(1);
    console.log("\nGolden 回归通过。");
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
