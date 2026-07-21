/**
 * 一次性：跑真实 guard 链，打印各场景逐步 decision 快照（供 Canvas 嵌入）。
 * 用法：pnpm exec tsx scripts/gen-intake-sandbox-fixtures.ts
 */
import {
  applyCompositeRouteGuard,
  applyIntakeChitchatGuard,
  applyIntakeContinuationGuard,
  applyIntakeLinkLookupGuard,
  applyIntakeRetrievalPlanGuard,
  applyEnumerationSlotGuard,
  applyPureSocialUtteranceGuard,
  type RoutedIntakeDecision,
} from "@/agentflow/agents/online/intake-coordinator/guards";
import {
  buildEarlyExitRoutedDecision,
  isClarifyEarlyExit,
  isRespondEarlyIntent,
} from "@/agentflow/agents/online/intake-coordinator/pipeline/intake-pipeline";
import { applyPathPlanGuard } from "@/agentflow/agents/online/intake-coordinator/path-plan";
import { applyToolPlanGuard } from "@/agentflow/agents/online/tool-orchestrator";
import { IDENTITY_FIELD_SEARCH } from "@/agentflow/agents/online/intake-coordinator/composite";
import { isUserFactIntent } from "@/agentflow/agents/online/user-fact";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";
import type { DbChatTurn } from "@fambrain/brain-types";

type Step = {
  id: string;
  title: string;
  file: string;
  note: string;
  earlyExit?: boolean;
  decision: unknown;
};

const pick = (d: IntakeRoutingDecision | RoutedIntakeDecision) => {
  const base: Record<string, unknown> = {
    intent: d.intent,
    searchQuery: d.searchQuery,
    queryType: d.queryType,
    topics: d.topics,
    subTasks: d.subTasks,
    confidence: d.confidence,
    clarifyingQuestion: d.clarifyingQuestion,
    briefReply: d.briefReply,
    retrievalPlan: d.retrievalPlan,
    userFactKey: d.userFactKey,
    userFactLabel: d.userFactLabel,
    userFactValue: d.userFactValue,
  };
  if ("routeMode" in d) {
    const r = d as RoutedIntakeDecision;
    base.routeMode = r.routeMode;
    base.composeMode = r.composeMode;
    base.routeReason = r.routeReason;
    base.routePlanSource = r.routePlanSource;
    base.compositeSlots = (r.compositeSlots ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      queryType: s.queryType,
      searchQuery: s.searchQuery,
      executor: s.executor ?? "km_retrieve",
      identityField: s.identityField ?? null,
      enumerationControl: s.enumerationControl ?? null,
    }));
    base.pathPlan = {
      km: r.pathPlan?.km?.length ?? 0,
      list: r.pathPlan?.list?.length ?? 0,
      tool: r.pathPlan?.tool?.length ?? 0,
      dag: (r.pathPlan?.dag ?? []).map((x) => x.template),
    };
    base.listIntent = r.listIntent ?? null;
    base.enrichedToolIds = (r.enrichedPlan ?? [])
      .map((p) => p.toolId)
      .filter(Boolean);
  }
  return base;
};

const runChain = async (input: {
  id: string;
  title: string;
  userQuestion: string;
  history: DbChatTurn[];
  llm: IntakeRoutingDecision;
}): Promise<{
  id: string;
  title: string;
  userQuestion: string;
  dirtyWhy: string;
  steps: Step[];
}> => {
  const steps: Step[] = [];
  let decision: IntakeRoutingDecision = structuredClone(input.llm);

  const push = (
    id: string,
    title: string,
    file: string,
    note: string,
    d: IntakeRoutingDecision | RoutedIntakeDecision,
    earlyExit?: boolean
  ) => {
    steps.push({
      id,
      title,
      file,
      note,
      earlyExit,
      decision: pick(d),
    });
  };

  push(
    "0",
    "① LLM 原始 JSON（有问题的起点）",
    "contract/prompt.ts · IntakeRoutingDecision",
    "模拟 Intake LLM 输出（Zod 已通过，但语义有问题）",
    decision
  );

  decision = applyPureSocialUtteranceGuard(decision, input.userQuestion);
  push(
    "1b",
    "①b 纯社交短路",
    "guards/intake-chitchat-guard.ts · applyPureSocialUtteranceGuard",
    "纯「你好/谢谢」强制 chitchat；否则 noop",
    decision
  );

  decision = applyIntakeContinuationGuard(
    decision,
    input.userQuestion,
    input.history
  );
  push(
    "2a",
    "②a 续问/指代 repair",
    "guards/intake-continuation-guard.ts · applyIntakeContinuationGuard",
    "短续问或误 clarify → retrieve；补 searchQuery",
    decision
  );

  if (decision.intent === "clarify" && isClarifyEarlyExit(decision)) {
    const routed = buildEarlyExitRoutedDecision(decision);
    push(
      "2",
      "② clarify 早退",
      "pipeline/intake-pipeline.ts · isClarifyEarlyExit",
      "仍 clarify → respondEarly",
      routed,
      true
    );
    return {
      id: input.id,
      title: input.title,
      userQuestion: input.userQuestion,
      dirtyWhy: "",
      steps,
    };
  }

  if (decision.intent === "chitchat") {
    decision = applyIntakeChitchatGuard(decision);
    push(
      "3",
      "③ 闲聊注入 briefReply",
      "guards/intake-chitchat-guard.ts · applyIntakeChitchatGuard",
      "服务端固定话术，忽略 LLM briefReply",
      decision
    );
  }

  if (isRespondEarlyIntent(decision)) {
    const routed = buildEarlyExitRoutedDecision(decision);
    push(
      "3b",
      "③b 非检索早退",
      "pipeline/intake-pipeline.ts · isRespondEarlyIntent",
      "chitchat / direct / out_of_scope / clarify → respondEarly",
      routed,
      true
    );
    return {
      id: input.id,
      title: input.title,
      userQuestion: input.userQuestion,
      dirtyWhy: "",
      steps,
    };
  }

  if (isUserFactIntent(decision.intent)) {
    const factKey = decision.userFactKey?.trim() ?? "";
    if (decision.intent === "recall_user_fact" && !factKey) {
      const identityPlan =
        (decision.retrievalPlan ?? []).find(
          (p) => p.queryType === "identity" || Boolean(p.identityField)
        ) ?? null;
      const field = identityPlan?.identityField ?? "name";
      const fieldSpec = IDENTITY_FIELD_SEARCH[field];
      decision = {
        ...decision,
        intent: "retrieve_and_answer",
        queryType: "identity",
        searchQuery: identityPlan?.searchQuery?.trim() || fieldSpec.searchQuery,
        topics: identityPlan?.topics?.length
          ? identityPlan.topics
          : ["personal", "resume"],
        subTasks:
          decision.subTasks.length > 0
            ? decision.subTasks
            : [fieldSpec.displayLabel],
        retrievalPlan: identityPlan
          ? [identityPlan]
          : [
              {
                label: fieldSpec.displayLabel,
                searchQuery: fieldSpec.searchQuery,
                queryType: "identity",
                topics: ["personal", "resume"],
                identityField: field,
                enumerationControl: null,
              },
            ],
        userFactKey: null,
        userFactLabel: null,
        userFactValue: null,
        clarifyingQuestion: null,
        briefReply: null,
      };
      push(
        "4-remap",
        "④ 无效 recall → identity retrieve",
        "pipeline/intake-pipeline.ts · invalid_recall remap",
        "缺 userFactKey 的 recall 改走语料 identity",
        decision
      );
    } else {
      const routed = buildEarlyExitRoutedDecision(decision);
      push(
        "4",
        "④ userFact 早退",
        "user-fact · isUserFactIntent",
        "remember/recall → userFact 节点",
        routed,
        true
      );
      return {
        id: input.id,
        title: input.title,
        userQuestion: input.userQuestion,
        dirtyWhy: "",
        steps,
      };
    }
  }

  decision = applyIntakeLinkLookupGuard(decision, input.userQuestion);
  push(
    "5a",
    "⑤a 对外链接 guard",
    "guards/intake-link-lookup-guard.ts · applyIntakeLinkLookupGuard",
    "外链纠偏 / 混合 plan 保留 / stale 收束",
    decision
  );

  decision = applyIntakeRetrievalPlanGuard(decision, input.userQuestion);
  push(
    "5",
    "⑤ 检索计划 guard",
    "guards/intake-retrieval-plan-guard.ts · applyIntakeRetrievalPlanGuard",
    "多问补 plan / expand identity / repair / canonicalize",
    decision
  );

  let routed = applyCompositeRouteGuard(decision, input.userQuestion);
  push(
    "6",
    "⑥ 复合路由",
    "guards/composite-route-guard.ts · applyCompositeRouteGuard",
    "retrievalPlan → compositeSlots + routeMode=slots",
    routed
  );

  routed = await applyEnumerationSlotGuard(routed, input.userQuestion, {
    conversationId: "sandbox",
    corpusUserId: "sandbox",
  });
  push(
    "7",
    "⑦ 列举分页",
    "guards/enumeration-list-intent.ts · applyEnumerationSlotGuard",
    "continue/exhaustive → executor=list_corpus",
    routed
  );

  routed = applyToolPlanGuard(routed, input.userQuestion);
  push(
    "8",
    "⑧ 工具计划",
    "tool-orchestrator/enrich-plan.ts · applyToolPlanGuard",
    "挂 toolId / 可选 hybrid DAG",
    routed
  );

  routed = applyPathPlanGuard(routed, input.userQuestion);
  push(
    "9",
    "⑨ PathPlan 四桶",
    "path-plan/compile-path-plan.ts · applyPathPlanGuard",
    "编译 km/list/tool/dag + composeMode",
    routed
  );

  push(
    "10",
    "⑩ 出口 → state.decision",
    "pipeline/intake-pipeline.ts · return",
    "写入 LangGraph state，routeAfterIntake 分流",
    routed
  );

  return {
    id: input.id,
    title: input.title,
    userQuestion: input.userQuestion,
    dirtyWhy: "",
    steps,
  };
};

const base = (
  partial: Partial<IntakeRoutingDecision> &
    Pick<IntakeRoutingDecision, "intent">
): IntakeRoutingDecision => ({
  searchQuery: "",
  subTasks: [],
  topics: [],
  language: "zh",
  confidence: 0.7,
  queryType: null,
  clarifyingQuestion: null,
  briefReply: null,
  retrievalPlan: [],
  userFactKey: null,
  userFactLabel: null,
  userFactValue: null,
  ...partial,
});

const main = async () => {
  const scenarios = [
    {
      id: "clarify-continue",
      title: "续问误 clarify",
      dirtyWhy:
        "有上文却标 clarify；短句「那前端呢？」应改 retrieve 并用 prior 补检索词",
      userQuestion: "那前端呢？",
      history: [
        {
          role: "user" as const,
          content: "城管平台用了什么技术栈？",
        },
        {
          role: "assistant" as const,
          content: "城管平台前端主要使用 React 与 TypeScript……（已答后端部分）",
        },
      ],
      llm: base({
        intent: "clarify",
        clarifyingQuestion: "你指的是哪个项目的前端？",
        confidence: 0.55,
        topics: ["project"],
      }),
    },
    {
      id: "link-mislabel",
      title: "外链误标 enumeration",
      dirtyWhy:
        "顶层 queryType=external_link，但 plan 项误标 enumeration + personal/resume",
      userQuestion: "开源项目的 GitHub 链接有哪些？",
      history: [],
      llm: base({
        intent: "retrieve_and_answer",
        searchQuery: "开源 GitHub 链接",
        queryType: "external_link",
        topics: ["personal", "resume", "project"],
        subTasks: ["开源 GitHub"],
        confidence: 0.88,
        retrievalPlan: [
          {
            label: "开源 GitHub 链接",
            searchQuery: "开源 GitHub",
            queryType: "enumeration",
            topics: ["personal", "resume"],
            enumerationControl: {
              action: "preview",
              listKind: "project",
              excludeHint: null,
            },
          },
        ],
      }),
    },
    {
      id: "multipart-empty-plan",
      title: "多问但 plan 为空",
      dirtyWhy:
        "档 B：subTasks≥2 且 plan=[] 时 ⑤ 不再发明槽；⑥ 编译为单槽 default（须靠 LLM 填齐 plan）",
      userQuestion: "我叫什么？今年多大？做过哪些项目？",
      history: [],
      llm: base({
        intent: "retrieve_and_answer",
        searchQuery: "姓名 年龄 项目",
        queryType: "identity",
        topics: ["personal", "resume", "project"],
        subTasks: ["姓名", "年龄", "项目经历"],
        confidence: 0.85,
        retrievalPlan: [],
      }),
    },
    {
      id: "invalid-recall",
      title: "无效 recall（姓名误标）",
      dirtyWhy: "recall_user_fact 无 userFactKey；④ remap 成 identity retrieve",
      userQuestion: "我叫什么名字？",
      history: [],
      llm: base({
        intent: "recall_user_fact",
        userFactKey: null,
        userFactLabel: "姓名",
        confidence: 0.7,
        subTasks: ["姓名"],
        retrievalPlan: [
          {
            label: "姓名",
            searchQuery: "个人简介 简历 姓名",
            queryType: "identity",
            topics: ["personal", "resume"],
            identityField: "name",
          },
        ],
      }),
    },
    {
      id: "age-ok",
      title: "正常单问年龄",
      dirtyWhy: "干净 JSON；应 noop 居多，⑨ 出 km + compute_age tool",
      userQuestion: "我今年多大？",
      history: [],
      llm: base({
        intent: "retrieve_and_answer",
        searchQuery: "个人简介 简历 年龄 出生年份 出生日期",
        queryType: "identity",
        topics: ["personal", "resume"],
        subTasks: ["年龄"],
        confidence: 0.92,
        retrievalPlan: [
          {
            label: "年龄",
            searchQuery: "个人简介 简历 年龄 出生年份 出生日期",
            queryType: "identity",
            topics: ["personal", "resume"],
            identityField: "age",
            enumerationControl: null,
          },
        ],
      }),
    },
    {
      id: "chitchat",
      title: "纯问候早退",
      dirtyWhy:
        "LLM 误判 retrieve；①b 改 chitchat → ③b 早退（Web 上 0a 更早拦）",
      userQuestion: "你好",
      history: [],
      llm: base({
        intent: "retrieve_and_answer",
        searchQuery: "你好",
        queryType: "default",
        confidence: 0.4,
      }),
    },
    {
      id: "remember-qq",
      title: "记住 QQ → userFact",
      dirtyWhy: "合法 remember；④ 早退 userFact，不进 KM",
      userQuestion: "记住我的QQ是734858469",
      history: [],
      llm: base({
        intent: "remember_user_fact",
        userFactKey: "qq",
        userFactLabel: "QQ号",
        userFactValue: "734858469",
        confidence: 0.95,
      }),
    },
    {
      id: "mixed-enum-link",
      title: "混合：列举 + GitHub",
      dirtyWhy: "真混合 plan；⑤a 应 preserve，不收成单槽",
      userQuestion: "列出全部项目，并给出开源项目的 GitHub 链接",
      history: [],
      llm: base({
        intent: "retrieve_and_answer",
        searchQuery: "项目经历 开源 GitHub",
        queryType: "enumeration",
        topics: ["project", "personal"],
        subTasks: ["列举所有项目", "开源 GitHub"],
        confidence: 0.9,
        retrievalPlan: [
          {
            label: "列举所有项目名称",
            searchQuery: "项目经历 全部项目 项目名称",
            queryType: "enumeration",
            topics: ["project"],
            enumerationControl: {
              action: "exhaustive",
              listKind: "project",
              excludeHint: null,
            },
          },
          {
            label: "开源项目的 GitHub 与线上地址",
            searchQuery:
              "个人简介 简历 开源 对外链接 仓库地址 线上预览 URL GitHub",
            queryType: "external_link",
            topics: ["personal", "resume", "project"],
            enumerationControl: null,
          },
        ],
      }),
    },
    {
      id: "list-exhaustive",
      title: "穷举列举项目",
      dirtyWhy: "enumerationControl.exhaustive → ⑦ executor=list_corpus",
      userQuestion: "列出全部项目名称",
      history: [],
      llm: base({
        intent: "retrieve_and_answer",
        searchQuery: "项目经历 全部项目 项目名称",
        queryType: "enumeration",
        topics: ["project"],
        subTasks: ["项目经历"],
        confidence: 0.93,
        retrievalPlan: [
          {
            label: "项目经历",
            searchQuery: "项目经历 全部项目 项目名称",
            queryType: "enumeration",
            topics: ["project"],
            enumerationControl: {
              action: "exhaustive",
              listKind: "project",
              excludeHint: null,
            },
          },
        ],
      }),
    },
  ];

  const out = [];
  for (const s of scenarios) {
    const r = await runChain(s);
    r.dirtyWhy = s.dirtyWhy;
    out.push(r);
  }
  console.log(JSON.stringify(out, null, 2));
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
