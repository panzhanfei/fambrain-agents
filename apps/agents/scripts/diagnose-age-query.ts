/**
 * 诊断「我今年多大」：路由 + KM 检索 + 语料字段。
 *
 *   pnpm --filter @fambrain/agents exec tsx --env-file=../../.env scripts/diagnose-age-query.ts
 */
import { readFile } from "node:fs/promises";
import { getRetrievalFromCache } from "@fambrain/infra";
import { applyCompositeRouteGuard } from "../src/agentflow/agents/online/intake-coordinator/composite-route-guard";
import { defaultIntakeDecision } from "../src/agentflow/pipeline/parse-intake";
import { retrieveKnowledge } from "../src/agentflow/agents/online/knowledge-manager/retrieve";
import { listCorpusUserIds } from "../src/agentflow/agents/offline/knowledge-indexer/list-corpus-users";

const USER_QUESTION = "我今年多大";
const IDENTITY_SEARCH =
  "个人简介 简历 姓名 年龄 职业 学历 行业";

const resolveCorpusUserId = async (): Promise<string> => {
  const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
  if (fromEnv) return fromEnv;
  const ids = await listCorpusUserIds();
  if (ids.length === 0) throw new Error("无 corpus 用户");
  return ids[0]!;
};

const corpusAgeFields = async (corpusUserId: string) => {
  const resumePath = `data/doc/users/${corpusUserId}/corpus/personal/个人简历-潘展飞.md`;
  try {
    const body = await readFile(resumePath, "utf8");
    const ageRe = /年龄|出生|周岁|\d{4}[年./-]\d{1,2}|19\d{2}|20\d{2}年/g;
    const matches = body.match(ageRe) ?? [];
    const tableRows = body
      .split("\n")
      .filter((l) => l.trim().startsWith("|") && /年龄|出生/.test(l));
    return { resumePath, bodyLen: body.length, matches, tableRows };
  } catch (e) {
    return {
      resumePath,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

const main = async () => {
  const corpusUserId = await resolveCorpusUserId();
  console.log("=== diagnose-age-query ===\n");
  console.log(`corpusUserId: ${corpusUserId}`);
  console.log(`userQuestion: ${USER_QUESTION}\n`);

  console.log("— 1. 语料 personal 简历 —");
  const corpus = await corpusAgeFields(corpusUserId);
  console.log(JSON.stringify(corpus, null, 2));

  console.log("\n— 2. 路由（Intake default + composite guard）—");
  const routed = applyCompositeRouteGuard(
    defaultIntakeDecision(USER_QUESTION),
    USER_QUESTION
  );
  console.log(
    JSON.stringify(
      {
        routeMode: routed.routeMode,
        queryType: routed.queryType,
        searchQuery: routed.searchQuery,
        slotLabel: routed.compositeSlots[0]?.label,
        routeReason: routed.routeReason,
      },
      null,
      2
    )
  );

  console.log("\n— 3. L2 检索 cache（identity 槽 key）—");
  const cacheKey = {
    corpusUserId,
    searchQuery: routed.searchQuery,
    queryType: routed.queryType ?? "identity",
  };
  const l2 = await getRetrievalFromCache(cacheKey);
  console.log(
    l2
      ? JSON.stringify({
            hitCount: l2.hits.length,
            coverage: l2.coverage,
            topPath: l2.hits[0]?.path,
          })
      : "cache miss"
  );

  console.log("\n— 4. KM 检索（slot canonical query）—");
  const searchQuery = routed.searchQuery || IDENTITY_SEARCH;
  let retrieval;
  try {
    retrieval = await retrieveKnowledge({
      corpusUserId,
      searchQuery,
      topics: routed.topics,
      subTasks: routed.subTasks,
      queryType: routed.queryType ?? "identity",
      candidates: [],
    });
  } catch (e) {
    console.error("retrieveKnowledge 失败:", e instanceof Error ? e.message : e);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        searchQuery,
        hitCount: retrieval.hits.length,
        coverage: retrieval.coverage,
        confidenceTier: retrieval.confidenceTier,
        notes: retrieval.notes,
        paths: retrieval.hits.map((h) => h.path),
        excerpts: retrieval.hits.slice(0, 3).map((h) => ({
          path: h.path,
          relevance: h.relevance,
          excerpt: h.excerpt.slice(0, 200),
        })),
      },
      null,
      2
    )
  );

  console.log("\n— 5. 结论 —");
  const hasAgeInExcerpt = retrieval.hits.some((h) =>
    /年龄|出生|周岁|19\d{2}|20\d{2}/.test(h.excerpt)
  );
  if (retrieval.hits.length === 0) {
    console.log("❌ hitCount=0 → Analyst 走 rules_empty_hits_skip_llm + 年龄兜底文案");
    console.log("   可能：Chroma 未索引 / 服务不可达 / sparse 也未命中");
  } else if (!hasAgeInExcerpt) {
    console.log("⚠️  有 hits 但 excerpt 无年龄/出生 → Analyst 会调 LLM，prompt 要求勿推算");
    console.log("   可能：语料无年龄字段，或 pickExcerpt 未摘到表格年龄行");
  } else {
    console.log("✅ hits 含年龄相关 excerpt，Web 上不应出现「未标注年龄」兜底");
  }

  console.log("\n— 6. 对比：错误 searchQuery（模拟路由未 canonical）—");
  const wrongCases = [
    {
      label: "single 原问 + default",
      searchQuery: USER_QUESTION,
      queryType: "default" as const,
      topics: [] as string[],
      subTasks: [] as string[],
    },
    {
      label: "原问 + identity 无 canonical 词",
      searchQuery: USER_QUESTION,
      queryType: "identity" as const,
      topics: [],
      subTasks: [],
    },
  ];
  for (const c of wrongCases) {
    const r = await retrieveKnowledge({
      corpusUserId,
      searchQuery: c.searchQuery,
      topics: c.topics,
      subTasks: c.subTasks,
      queryType: c.queryType,
      candidates: [],
    });
    console.log(
      c.label,
      JSON.stringify({
        hitCount: r.hits.length,
        coverage: r.coverage,
        topPath: r.hits[0]?.path,
        hasBirthInExcerpt: r.hits.some((h) => /出生|1993/.test(h.excerpt)),
      })
    );
  }

  console.log("\n— 7. Intake 返回 queryType=default（当前 guard 应修正为 slot）—");
  const intakeWrong = {
    intent: "retrieve_and_answer" as const,
    needsRetrieval: true,
    searchQuery: USER_QUESTION,
    subTasks: [],
    topics: [],
    language: "zh" as const,
    confidence: 0.9,
    queryType: "default" as const,
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [],
  };
  const fixed = applyCompositeRouteGuard(intakeWrong, USER_QUESTION);
  console.log(
    JSON.stringify(
      {
        routeMode: fixed.routeMode,
        searchQuery: fixed.searchQuery,
        label: fixed.compositeSlots[0]?.label,
      },
      null,
      2
    )
  );
};

await main();
