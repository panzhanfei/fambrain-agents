/**
 * 诊断「项目列举只列 2 个」：语料数 → KM → ContentOrganizer → Analyst 可见 hits。
 *
 *   FAMBRAIN_CORPUS_USER_ID=xxx pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-projects-query.ts
 */
import path from "node:path";
import { listCorpusScanRoots, listMarkdownFiles, toRepoPath } from "@fambrain/corpus";
import { PROJECTS_SLOT } from "../src/agentflow/agents/online/intake-coordinator";
import { organizeKnowledge } from "../src/agentflow/agents/online/content-organizer/organize-knowledge";
import { maxAnalystHitsForProfile } from "../src/agentflow/agents/online/information-analyst/complete-analyze";
import { buildSubQuestionFallbackAnswer } from "../src/agentflow/agents/online/information-analyst/analyze-helpers";
import { isProjectEntryPath } from "../src/agentflow/agents/online/knowledge-manager/recall/retrieve-helpers";
import { retrieveKnowledge } from "../src/agentflow/agents/online/knowledge-manager/recall/retrieve";
import { listCorpusUserIds } from "../src/agentflow/agents/offline/knowledge-indexer/list-corpus-users";

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv) return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) throw new Error("无 corpus 用户");
    return ids[0]!;
};

const basename = (p: string) => p.split("/").pop() ?? p;

const main = async () => {
    const corpusUserId = await resolveCorpusUserId();
    const slot = PROJECTS_SLOT;

    const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);
    const projectFiles: string[] = [];
    for (const { root } of scanRoots) {
        const dir = path.join(root, "projects");
        for (const abs of await listMarkdownFiles(dir)) {
            const repo = toRepoPath(abs);
            if (isProjectEntryPath(repo)) projectFiles.push(basename(repo));
        }
    }
    projectFiles.sort();

    const km = await retrieveKnowledge({
        corpusUserId,
        searchQuery: slot.searchQuery,
        topics: slot.topics,
        subTasks: [slot.label],
        queryType: slot.queryType,
        candidates: [],
    });

    const organized = organizeKnowledge({
        hits: km.hits,
        coverage: km.coverage,
        notes: km.notes,
        queryProfile: "enumeration",
    });

    const analystLimit = maxAnalystHitsForProfile("enumeration");
    const analystHits = organized.hits.slice(0, analystLimit);
    const rulesAnswer = buildSubQuestionFallbackAnswer({
        userQuestion: slot.label,
        language: "zh",
        hits: analystHits,
        coverage: organized.coverage,
        notes: organized.notes,
        queryType: "enumeration",
        topics: slot.topics,
    });
    const bulletCount = (rulesAnswer.answer.match(/^- \*\*/gm) ?? []).length;

    console.log("diagnose-projects-query");
    console.log(`corpusUserId=${corpusUserId}\n`);

    console.log("=== 1. 语料 projects/ 有效 md ===");
    console.log(`count=${projectFiles.length}`);
    console.log(`files=${projectFiles.join(", ")}\n`);

    console.log("=== 2. KM retrieveKnowledge（composite 项目槽）===");
    console.log(`hitCount=${km.hits.length} (cap enumeration=8)`);
    console.log(`coverage=${km.coverage}`);
    console.log(`notes=${km.notes ?? "null"}`);
    console.log(`paths=${km.hits.map((h) => basename(h.path)).join(", ")}\n`);

    console.log("=== 3. ContentOrganizer ===");
    console.log(`before=${km.hits.length} after=${organized.hits.length} (enumeration maxHits=8)`);
    console.log(`paths=${organized.hits.map((h) => basename(h.path)).join(", ")}\n`);

    console.log("=== 4. Analyst 可见 hits（规则路径，不调 LLM）===");
    console.log(`analystLimit=${analystLimit} fed=${analystHits.length}`);
    console.log(`rulesBulletCount=${bulletCount}`);
    console.log(`rulesPreview=\n${rulesAnswer.answer.slice(0, 600)}${rulesAnswer.answer.length > 600 ? "…" : ""}\n`);

    const kmMissing = projectFiles.filter(
        (f) => !km.hits.some((h) => basename(h.path) === f)
    );
    console.log("=== 5. 结论摘要 ===");
    console.log(
        `KM 未覆盖项目文件: ${kmMissing.length}/${projectFiles.length}` +
            (kmMissing.length > 0 && kmMissing.length <= 10
                ? ` (${kmMissing.join(", ")})`
                : kmMissing.length > 10
                  ? ` (前10: ${kmMissing.slice(0, 10).join(", ")} …)`
                  : "")
    );
    if (organized.hits.length >= 5) {
        console.log(
            "→ enumeration 走 rules + blocks（不调 LLM）；Web 应显示表格 +「共 N 个，已显示 M 个」"
        );
    }
    if (km.hits.length <= 2) {
        console.log("→ 根因在 KM 层（检索/cache/queryType）");
    }
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
