/**
 * P0-15 / R6-3：Intake retrievalPlan 主路由 + 结构兜底 + merge 单测。
 *
 *   pnpm --filter @fambrain/brain-service run verify:composite-route
 */
import {
  applyCompositeRouteGuard,
  applyIntakeRetrievalPlanGuard,
  buildFallbackRetrievalPlan,
  canonicalizePlanItem,
  EMPLOYERS_SLOT,
  isCompositeProfileQuestion,
  looksLikeMultiPartQuestion,
  PROJECTS_SLOT,
  resolveCompositeRoute,
  splitQuestionUnits,
  type IntakeRoutingDecision,
} from "../src/agentflow/agents/online/intake-coordinator/index";
import {
  mergeCompositeHits,
  mergeCompositeRetrieval,
} from "../src/agentflow/agents/online/knowledge-manager/composite/merge";
import { mergeSubQuestionAnswers } from "../src/agentflow/agents/online/information-analyst/analyze-helpers";

const retrieveStub: IntakeRoutingDecision = {
  intent: "retrieve_and_answer",
  searchQuery: "用户原问",
  subTasks: [],
  topics: [],
  language: "zh",
  confidence: 0.8,
  queryType: "identity",
  clarifyingQuestion: null,
  briefReply: null,
  retrievalPlan: [],
};

const assertSync = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}: ${msg}`);
    process.exitCode = 1;
  }
};

console.log("verify-composite-route\n— Intake retrievalPlan —");

assertSync("retrievalPlan ≥2 → slots×2", () => {
  const decision: IntakeRoutingDecision = {
    ...retrieveStub,
    retrievalPlan: [
      {
        label: "姓名",
        searchQuery: "个人简介 简历 姓名",
        queryType: "identity",
        topics: ["personal", "resume"],
      },
      {
        label: "项目经历",
        searchQuery: "项目经历 全部项目",
        queryType: "enumeration",
        topics: ["project"],
      },
    ],
    subTasks: ["姓名", "项目经历"],
  };
  const out = applyCompositeRouteGuard(decision, "综合问");
  if (out.routeMode !== "slots" || out.compositeSlots.length !== 2) {
    throw new Error(`期望 slots×2，实际 ${out.routeMode}/${out.compositeSlots.length}`);
  }
  if (out.routeReason !== "intake_retrieval_plan") {
    throw new Error(`routeReason=${out.routeReason}`);
  }
});

assertSync("P0-15 五连问（无 plan）→ 结构兜底 slots", () => {
  const q =
    "我叫什么？ 今年多大？ 做过那些项目？ 从事什么行业？什么学历？";
  if (!looksLikeMultiPartQuestion(q)) {
    throw new Error("应识别多问结构");
  }
  const units = splitQuestionUnits(q);
  if (units.length < 5) {
    throw new Error(`分句不足: ${units.length} ${units.join("|")}`);
  }
  const out = applyCompositeRouteGuard(retrieveStub, q);
  if (out.routeMode !== "slots" || out.compositeSlots.length < 5) {
    throw new Error(
      `期望 slots≥5槽，实际 ${out.routeMode}/${out.compositeSlots.length}`
    );
  }
  if (out.routeReason !== "structural_multipart_fallback") {
    throw new Error(`routeReason=${out.routeReason}`);
  }
  const projectsSlot = out.compositeSlots.find((s) =>
    /项目/.test(s.label)
  );
  if (!projectsSlot || projectsSlot.queryType !== "enumeration") {
    throw new Error("项目子问应为 enumeration 检索");
  }
  if (projectsSlot.topics[0] !== "project") {
    throw new Error(`项目槽 topics 应为 project，实际 ${projectsSlot.topics.join(",")}`);
  }
});

assertSync("plan label「具体项目名称」→ canonical 为 projects 槽", () => {
  const item = canonicalizePlanItem({
    label: "具体项目名称",
    searchQuery: "用户口语",
    queryType: "enumeration",
    topics: ["experience"],
  });
  if (item.searchQuery !== PROJECTS_SLOT.searchQuery) {
    throw new Error(`应 canonical 到 projects searchQuery，实际 ${item.searchQuery}`);
  }
  if (!item.topics.includes("project")) {
    throw new Error(`topics 应含 project，实际 ${item.topics.join(",")}`);
  }
  if (item.searchQuery === EMPLOYERS_SLOT.searchQuery) {
    throw new Error("不应 canonical 到 employers");
  }
});

assertSync("单问列举 → slots×1 employers + canonical", () => {
  const out = applyCompositeRouteGuard(
    { ...retrieveStub, queryType: "enumeration", topics: ["experience"] },
    "我在哪几家公司上过班？"
  );
  if (
    out.routeMode !== "slots" ||
    out.compositeSlots.length !== 1 ||
    out.searchQuery !== EMPLOYERS_SLOT.searchQuery
  ) {
    throw new Error(`slots/canonical 不符: ${out.routeMode} ${out.searchQuery}`);
  }
});

assertSync("paraphrase 供职单位 → slots employers", () => {
  const out = applyCompositeRouteGuard(
    {
      ...retrieveStub,
      queryType: "enumeration",
      topics: ["experience"],
      searchQuery: "供职单位 工作经历",
    },
    "供职过哪些单位？"
  );
  if (
    out.routeMode !== "slots" ||
    out.compositeSlots.length !== 1 ||
    out.compositeSlots[0]?.id !== "employers"
  ) {
    throw new Error(`期望 slots employers，实际 ${out.routeMode}`);
  }
});

assertSync("城管技术 → slots×1", () => {
  const out = applyCompositeRouteGuard(
    { ...retrieveStub, queryType: "tech", searchQuery: "城管平台 技术栈" },
    "城管平台用了什么技术"
  );
  if (out.routeMode !== "slots" || out.compositeSlots.length !== 1) {
    throw new Error(`实际 ${out.routeMode}/${out.compositeSlots.length}`);
  }
});

assertSync("闲聊 → skip", () => {
  const out = applyCompositeRouteGuard(
    {
      ...retrieveStub,
      intent: "chitchat",
      briefReply: "你好",
    },
    "你好"
  );
  if (out.routeMode !== "skip") throw new Error("chitchat 应为 skip");
});

assertSync("单问年龄（Intake identity）→ slots×1 + identity 模板", () => {
  const q = "我今年多大";
  const out = applyCompositeRouteGuard(
    { ...retrieveStub, queryType: "identity", searchQuery: "个人简介 简历 年龄 出生年份", subTasks: [] },
    q
  );
  if (out.routeMode !== "slots" || out.compositeSlots.length !== 1) {
    throw new Error(`期望 slots×1，实际 ${out.routeMode}/${out.compositeSlots.length}`);
  }
  if (!out.searchQuery.includes("个人简介") || !out.searchQuery.includes("年龄")) {
    throw new Error(`searchQuery 未 canonicalize: ${out.searchQuery}`);
  }
  if (out.compositeSlots[0]?.queryType !== "identity") {
    throw new Error(`queryType=${out.compositeSlots[0]?.queryType}`);
  }
});

assertSync("年龄多大（Intake identity）→ slots×1", () => {
  const q = "年龄多大";
  const out = applyCompositeRouteGuard(
    { ...retrieveStub, queryType: "identity", searchQuery: "个人简介 简历 年龄", topics: ["personal", "resume"] },
    q
  );
  if (
    out.routeMode !== "slots" ||
    out.compositeSlots.length !== 1 ||
    out.compositeSlots[0]?.queryType !== "identity"
  ) {
    throw new Error(`slots identity 不符: ${out.routeMode}`);
  }
});

console.log("\n— 结构 / subTasks 兜底 —");

assertSync("Intake subTasks ≥2 → slots", () => {
  const decision: IntakeRoutingDecision = {
    ...retrieveStub,
    queryType: "default",
    searchQuery: "个人简介 项目 工作经历",
    subTasks: ["提取姓名", "列举项目", "哪几家公司", "近两年动态"],
    topics: ["personal", "experience", "project"],
  };
  const plan = buildFallbackRetrievalPlan("整体介绍一下", decision);
  if (plan.length < 4) throw new Error(`plan 不足: ${plan.length}`);
  const out = applyCompositeRouteGuard(decision, "整体介绍一下");
  if (out.routeMode !== "slots" || out.compositeSlots.length < 2) {
    throw new Error(`期望 slots≥2，实际 ${out.routeMode}/${out.compositeSlots.length}`);
  }
});

assertSync("用户句空 + Intake enumeration → slots×1", () => {
  const decision: IntakeRoutingDecision = {
    ...retrieveStub,
    queryType: "enumeration",
    searchQuery: "工作经历 公司 列举",
    topics: ["experience"],
    subTasks: ["列出全部公司"],
  };
  const resolved = resolveCompositeRoute(decision, "能说说吗");
  if (resolved.slots.length !== 1 || resolved.slots[0]?.id !== "employers") {
    throw new Error(`期望 employers 模板，实际 ${resolved.slots[0]?.id}`);
  }
});

assertSync("retrievalPlan 5 项 → 非固定 4 槽", () => {
  const q =
    "我叫什么？ 今年多大？ 做过那些项目？ 从事什么行业？什么学历？";
  const plan = buildFallbackRetrievalPlan(q, {
    ...retrieveStub,
    searchQuery: "个人简介 简历 项目",
  });
  if (plan.length !== 5) throw new Error(`plan=${plan.length}`);
  if (
    !isCompositeProfileQuestion(
      { ...retrieveStub, retrievalPlan: plan },
      q
    )
  ) {
    throw new Error("应识别 composite");
  }
});

console.log("\n— Intake retrievalPlan guard —");

assertSync("多问但 plan 空 → guard 补 fallback", () => {
  const q =
    "我叫什么？ 今年多大？ 做过那些项目？ 从事什么行业？什么学历？";
  const guarded = applyIntakeRetrievalPlanGuard(retrieveStub, q);
  if ((guarded.retrievalPlan?.length ?? 0) < 5) {
    throw new Error(`plan 不足: ${guarded.retrievalPlan?.length}`);
  }
  if (guarded.retrievalPlanGuardReason !== "filled_fallback") {
    throw new Error(`reason=${guarded.retrievalPlanGuardReason}`);
  }
  const out = applyCompositeRouteGuard(guarded, q);
  if (out.routeMode !== "slots" || out.compositeSlots.length < 5) {
    throw new Error(`期望 slots≥5，实际 ${out.routeMode}/${out.compositeSlots.length}`);
  }
});

assertSync("plan identity 项 → canonical searchQuery（检索 hits 缓存）", () => {
  const guarded = applyIntakeRetrievalPlanGuard(
    {
      ...retrieveStub,
      retrievalPlan: [
        {
          label: "姓名",
          searchQuery: "用户口语 姓名 叫什么",
          queryType: "identity",
          topics: ["personal", "resume"],
        },
        {
          label: "学历",
          searchQuery: "啥学历啊",
          queryType: "identity",
          topics: ["personal"],
        },
      ],
    },
    "姓名？学历？"
  );
  const sq = guarded.retrievalPlan[0]?.searchQuery ?? "";
  if (!sq.includes("个人简介") || !sq.includes("简历")) {
    throw new Error(`未 canonicalize: ${sq}`);
  }
});

console.log("\n— merge —");

assertSync("merge hits 按 path 去重", () => {
  const merged = mergeCompositeHits([
    {
      slot: "plan-0",
      label: "x",
      hits: [{ path: "a.md", title: "A", excerpt: "潘展飞", relevance: 0.9 }],
      coverage: "sufficient",
      notes: null,
      cacheHit: false,
    },
    {
      slot: "plan-1",
      label: "y",
      hits: [
        { path: "a.md", title: "A", excerpt: "dup", relevance: 0.5 },
        { path: "b.md", title: "B", excerpt: "奥卡云", relevance: 0.8 },
      ],
      coverage: "partial",
      notes: null,
      cacheHit: false,
    },
  ]);
  if (merged.length !== 2 || merged[0]?.path !== "a.md") {
    throw new Error(`去重失败: ${JSON.stringify(merged)}`);
  }
});

assertSync("merge coverage → partial", () => {
  const r = mergeCompositeRetrieval([
    {
      slot: "plan-0",
      label: "x",
      hits: [{ path: "a", title: "A", excerpt: "x", relevance: 1 }],
      coverage: "sufficient",
      notes: null,
      cacheHit: false,
    },
    {
      slot: "plan-1",
      label: "y",
      hits: [],
      coverage: "none",
      notes: null,
      cacheHit: false,
    },
  ]);
  if (r.coverage !== "partial")
    throw new Error(`期望 partial，实际 ${r.coverage}`);
});

assertSync("mergeSubQuestionAnswers 分段合并", () => {
  const merged = mergeSubQuestionAnswers([
    {
      order: 0,
      label: "姓名",
      result: {
        answer: "潘展飞",
        citations: [],
        confidence: 0.9,
        insufficientEvidence: false,
      },
    },
    {
      order: 1,
      label: "学历",
      result: {
        answer: "专科（统招）",
        citations: [],
        confidence: 0.9,
        insufficientEvidence: false,
      },
    },
  ]);
  if (!merged.answer.includes("1. 姓名") || !merged.answer.includes("2. 学历")) {
    throw new Error(`分段合并失败: ${merged.answer}`);
  }
});

if (process.exitCode) {
  console.log("\nFAILED");
  process.exit(process.exitCode);
}
console.log("\nOK");
