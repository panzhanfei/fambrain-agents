/**
 * Golden G1～G5 + GMem：在线 Agent 全链路标准回归（最终验收用）。
 *
 * 覆盖 Intake → KM → FactChecker → ContentOrganizer → Analyst；
 * 用固定问法 + steps/answer 断言建立基线，填坑前后对比通过率。
 *
 *   pnpm run golden:regression
 *   GOLDEN_RUNS=3 pnpm run golden:regression
 *   pnpm run golden:regression -- 3
 *
 * 需 Ollama + Chroma + 已入库语料；corpusUserId 见 FAMBRAIN_CORPUS_USER_ID
 * 或 data/doc/users/ 下首个有 corpus 的用户。
 */
import type { AgentPipelineContext, DbChatTurn } from "@fambrain/agent-types";
import { listCorpusUserIds } from "@/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { runPipelineStream } from "@/agentflow/index";
import { bootstrapAgentsRuntime } from "@/config";

/** 默认连跑遍数；也可用环境变量 GOLDEN_RUNS 或 CLI 参数覆盖 */
const DEFAULT_GOLDEN_RUNS = 3;

type GoldenId = "G1" | "G2" | "G3" | "G4" | "G5" | "G5b" | "GMem";

/** 跨会话记忆探测用 QQ（与 verify:user-fact 一致） */
const GOLDEN_QQ = "734858469";

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

type GoldenRunResult = {
  runIndex: number;
  results: PipelineCaseResult[];
  durationMs: number;
};

type GoldenCase = {
  id: GoldenId;
  label: string;
  question: string;
  history?: DbChatTurn[];
  contextOverrides?: Partial<AgentPipelineContext>;
  assert: (
    result: Omit<
      PipelineCaseResult,
      "id" | "label" | "question" | "pass" | "reason"
    >
  ) => string | null;
};

const CLARIFY_ANSWER = /哪|哪个|请说明|指的是|哪一段|哪一家|什么项目|能否说明/;

const hasStep = (steps: string[], name: string): boolean =>
  steps.includes(name);

const hasRetrievalChain = (steps: string[]): boolean =>
  hasStep(steps, "retrieval") &&
  hasStep(steps, "fact_checker") &&
  hasStep(steps, "content_organizer") &&
  hasStep(steps, "analyst");

const parseGoldenRuns = (): number => {
  const fromArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
  const fromEnv = process.env.GOLDEN_RUNS?.trim();
  const raw = fromArg ?? fromEnv ?? String(DEFAULT_GOLDEN_RUNS);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1)
    throw new Error(`GOLDEN_RUNS 须为正整数，当前: ${raw}`);
  return n;
};

const resolveCorpusUserId = async (): Promise<string> => {
  const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
  if (fromEnv) return fromEnv;
  const ids = await listCorpusUserIds();
  if (ids.length === 0) {
    throw new Error(
      "无可用语料用户：请设置 FAMBRAIN_CORPUS_USER_ID，或先 pnpm run index:corpus"
    );
  }
  return ids[0]!;
};

const buildContext = (
  corpusUserId: string,
  caseId: GoldenId,
  runIndex: number,
  overrides: Partial<AgentPipelineContext> = {}
): AgentPipelineContext => ({
  actorUserId: corpusUserId,
  corpusUserId,
  displayName: "Golden 回归",
  conversationId: `golden-r${runIndex}-${caseId}-${Date.now()}`,
  ...overrides,
});

const runPipelineCase = async (
  corpusUserId: string,
  spec: GoldenCase,
  runIndex: number
): Promise<PipelineCaseResult> => {
  const started = Date.now();
  const steps: string[] = [];
  let answer = "";
  let error: string | undefined;
  const history: DbChatTurn[] = [
    ...(spec.history ?? []),
    { role: "user", content: spec.question },
  ];
  const gen = runPipelineStream(
    history,
    buildContext(corpusUserId, spec.id, runIndex, spec.contextOverrides)
  );
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
      if (!answer.trim()) return "answer 为空";
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
      if (!answer.trim()) return "answer 为空";
      return null;
    },
  },
  {
    id: "G3",
    label: "项目与技术",
    question: "我做过的项目和掌握的技术",
    assert: ({ steps, answer }) => {
      if (!hasStep(steps, "retrieval")) return "应进入 retrieval";
      if (!hasStep(steps, "analyst")) return "应进入 analyst 写终稿";
      if (answer.trim().length < 60) return "回答过短，应有分点或段落";
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
      if (hasStep(steps, "analyst")) return "无上下文时不应进入 analyst 编造";
      if (!hasStep(steps, "intake")) return "应至少经过 intake";
      if (!CLARIFY_ANSWER.test(answer))
        return "answer 应像澄清问句（含「哪/哪个/指的是」等）";
      return null;
    },
  },
  {
    id: "G5b",
    label: "多轮指代补全（QU-02）",
    history: [
      { role: "user", content: "城管平台用了什么技术" },
      {
        role: "assistant",
        content:
          "城市管理平台前端使用 React、TypeScript、Vite；小程序端使用 UniApp。",
      },
    ],
    question: "那个项目呢？",
    assert: ({ steps, answer }) => {
      if (!hasStep(steps, "retrieval"))
        return "有上文时应走 retrieval，不应 clarify";
      if (CLARIFY_ANSWER.test(answer)) return "answer 不应再澄清「哪个项目」";
      if (!/城管|城市管理|React|UniApp|TypeScript|Vite/i.test(answer))
        return "应延续上文城市管理平台主题，而非无关项目";
      return null;
    },
  },
];

const runPipelineTurn = async (
  history: DbChatTurn[],
  context: AgentPipelineContext
): Promise<{ steps: string[]; answer: string; error?: string }> => {
  const steps: string[] = [];
  let answer = "";
  let error: string | undefined;
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
  return { steps, answer, error };
};

/** 对话 A 记 QQ → 新 conversationId B 问 QQ */
const runCrossSessionMemCase = async (
  corpusUserId: string,
  runIndex: number
): Promise<PipelineCaseResult> => {
  const started = Date.now();
  const actorUserId = `golden-gmem-r${runIndex}-${Date.now()}`;
  const rememberQ = `我的qq是${GOLDEN_QQ}`;
  const recallQ = "我的qq是多少";

  const remember = await runPipelineTurn(
    [{ role: "user", content: rememberQ }],
    {
      actorUserId,
      corpusUserId,
      displayName: "Golden 回归",
      conversationId: `golden-gmem-a-r${runIndex}`,
    }
  );
  if (remember.error) {
    return {
      id: "GMem",
      label: "跨会话记忆 QQ（P0-16）",
      question: `${rememberQ} → ${recallQ}`,
      steps: remember.steps,
      answer: remember.answer,
      error: remember.error,
      latencyMs: Date.now() - started,
      pass: false,
      reason: `remember 阶段 pipeline error: ${remember.error}`,
    };
  }

  const recall = await runPipelineTurn(
    [{ role: "user", content: recallQ }],
    {
      actorUserId,
      corpusUserId,
      displayName: "Golden 回归",
      conversationId: `golden-gmem-b-r${runIndex}`,
    }
  );
  const latencyMs = Date.now() - started;
  const base = {
    steps: recall.steps,
    answer: recall.answer,
    error: recall.error,
    latencyMs,
  };

  let failReason: string | null = null;
  if (recall.error) failReason = `recall 阶段 pipeline error: ${recall.error}`;
  else if (!recall.answer.includes(GOLDEN_QQ))
    failReason = `recall answer 应含 QQ ${GOLDEN_QQ}`;
  else if (!hasStep(recall.steps, "user_fact"))
    failReason = "recall 应走 user_fact 节点";

  return {
    id: "GMem",
    label: "跨会话记忆 QQ（P0-16）",
    question: `${rememberQ} → ${recallQ}`,
    ...base,
    pass: failReason === null && !recall.error,
    reason: recall.error
      ? `pipeline error: ${recall.error}`
      : (failReason ?? "ok"),
  };
};

const ANSWER_PREVIEW_CHARS = 320;

const formatDuration = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

const runGoldenSuite = async (
  corpusUserId: string,
  runIndex: number,
  totalRuns: number
): Promise<GoldenRunResult> => {
  const started = Date.now();
  const results: PipelineCaseResult[] = [];
  const caseTotal = GOLDEN_CASES.length + 1;
  console.log(`\n── 第 ${runIndex}/${totalRuns} 遍 ──`);
  for (let i = 0; i < GOLDEN_CASES.length; i++) {
    const spec = GOLDEN_CASES[i]!;
    console.log(`  [${i + 1}/${caseTotal}] ${spec.id} · 「${spec.question}」…`);
    const result = await runPipelineCase(corpusUserId, spec, runIndex);
    console.log(
      `       → ${result.pass ? "PASS" : "FAIL"} ${formatDuration(result.latencyMs)}`
    );
    results.push(result);
  }
  console.log(`  [${caseTotal}/${caseTotal}] GMem · 跨会话 QQ…`);
  const memResult = await runCrossSessionMemCase(corpusUserId, runIndex);
  console.log(
    `       → ${memResult.pass ? "PASS" : "FAIL"} ${formatDuration(memResult.latencyMs)}`
  );
  results.push(memResult);
  return { runIndex, results, durationMs: Date.now() - started };
};

const printAnswer = (answer: string): void => {
  const answerText = answer.trim() || "(空)";
  if (answerText.length <= ANSWER_PREVIEW_CHARS) {
    console.log(`答：${answerText}`);
    return;
  }
  console.log(`答：${answerText.slice(0, ANSWER_PREVIEW_CHARS)}…`);
  console.log(`   （共 ${answerText.length} 字，已截断）`);
};

const printOneRunBlock = (run: GoldenRunResult): void => {
  const passed = run.results.filter((r) => r.pass);
  const failed = run.results.filter((r) => !r.pass);
  const line = "─".repeat(72);

  console.log(`\n${"▓".repeat(72)}`);
  console.log(
    `第 ${run.runIndex} 遍  （耗时 ${formatDuration(run.durationMs)}）`
  );
  console.log(`${"▓".repeat(72)}\n`);

  for (const r of run.results) {
    const verdict = r.pass ? "✓ PASS" : "✗ FAIL";
    console.log(line);
    console.log(
      `${r.id}  ${r.label}  [${verdict}]  ${formatDuration(r.latencyMs)}`
    );
    console.log(`问：${r.question}`);
    printAnswer(r.answer);
    console.log(`评判：${r.reason}`);
    if (r.error) console.log(`错误：${r.error}`);
    console.log("");
  }

  console.log(line);
  console.log(
    `通过率：${passed.length}/${run.results.length}（目标 ≥5/7，G1～G5 核心 ≥4/5）`
  );
  console.log(
    `通过：${passed.length ? passed.map((r) => r.id).join("、") : "（无）"}`
  );
  console.log(
    `未通过：${failed.length ? failed.map((r) => `${r.id}（${r.reason}）`).join("；") : "（无）"}`
  );
};

const printMultiRunReport = (
  runs: GoldenRunResult[],
  corpusUserId: string,
  totalRuns: number
): void => {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`Golden 回归总报告（共 ${totalRuns} 遍）`);
  console.log(`corpusUserId: ${corpusUserId}`);
  console.log(`${"═".repeat(72)}`);
  console.log("（以下按遍展示：问 → 答 → 评判；汇总通过/未通过）");

  for (const run of runs) printOneRunBlock(run);

  const fullyPassedRuns = runs.filter((run) =>
    run.results.every((r) => r.pass)
  ).length;
  const passRates = runs.map((run) => {
    const n = run.results.filter((r) => r.pass).length;
    return `${n}/${run.results.length}`;
  });

  console.log(`\n${"═".repeat(72)}`);
  console.log("稳定性汇总");
  console.log(`${"═".repeat(72)}`);
  for (const run of runs) {
    const n = run.results.filter((r) => r.pass).length;
    const failedIds =
      run.results
        .filter((r) => !r.pass)
        .map((r) => r.id)
        .join(",") || "—";
    console.log(
      `  第 ${run.runIndex} 遍  ${n}/${run.results.length}  未通过: ${failedIds}`
    );
  }
  console.log(`\n各遍通过率：${passRates.join(" · ")}`);
  console.log(`全轮 G1～GMem 均通过：${fullyPassedRuns}/${totalRuns} 遍`);
  console.log(`${"═".repeat(72)}`);
};

const main = async (): Promise<void> => {
  bootstrapAgentsRuntime();
  const totalRuns = parseGoldenRuns();
  const corpusUserId = await resolveCorpusUserId();
  console.log(
    `Golden G1～G5 + GMem 全链路回归（corpusUserId=${corpusUserId}，连跑 ${totalRuns} 遍）`
  );
  console.log("运行中仅显示进度；问/答/评判与各遍汇总将在全部结束后统一展示…");

  const runs: GoldenRunResult[] = [];
  for (let runIndex = 1; runIndex <= totalRuns; runIndex++) {
    runs.push(await runGoldenSuite(corpusUserId, runIndex, totalRuns));
  }

  printMultiRunReport(runs, corpusUserId, totalRuns);

  const anyFailure = runs.some((run) => run.results.some((r) => !r.pass));
  if (anyFailure) process.exit(1);
  console.log("\nGolden 回归通过。");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
