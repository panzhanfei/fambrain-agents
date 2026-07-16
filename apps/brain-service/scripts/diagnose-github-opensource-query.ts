/**
 * 诊断「开源 GitHub 链接」对话：语料事实 → KM 检索 → Intake（live）。
 *
 *   pnpm --filter @fambrain/brain-service exec tsx --env-file=../../.env scripts/diagnose-github-opensource-query.ts
 */
import path from "node:path";
import type { DbChatTurn } from "@fambrain/brain-types";
import { listCorpusScanRoots, listMarkdownFiles, toRepoPath } from "@fambrain/corpus";
import {
    completeIntakeCoordinator,
    runIntakePipeline,
} from "../src/agentflow/agents/online/intake-coordinator";
import { listCorpusUserIds } from "../src/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { retrieveKnowledge } from "../src/agentflow/agents/online/knowledge-manager/recall/retrieve";
import { bootstrapBrainServiceRuntime } from "../src/config/index";

const GITHUB_RE = /https?:\/\/github\.com\/[^\s)>]+/gi;

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv) return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) throw new Error("无 corpus 用户");
    return ids[0]!;
};

const scanGithubInCorpus = async (corpusUserId: string) => {
    const scanRoots = await listCorpusScanRoots(corpusUserId, listMarkdownFiles);
    const hits: { path: string; urls: string[] }[] = [];
    for (const { root } of scanRoots) {
        for (const abs of await listMarkdownFiles(root)) {
            const repoPath = toRepoPath(abs);
            const text = await import("node:fs/promises").then((fs) => fs.readFile(abs, "utf8"));
            const urls = [...text.matchAll(GITHUB_RE)].map((m) => m[0]);
            if (urls.length > 0) hits.push({ path: repoPath, urls: [...new Set(urls)] });
        }
    }
    return hits;
};

const basename = (p: string) => p.split("/").pop() ?? p;

const kmProbe = async (
    corpusUserId: string,
    label: string,
    searchQuery: string,
    queryType: "identity" | "enumeration" | "tech" | "external_link" | "default" = "default"
) => {
    const km = await retrieveKnowledge({
        corpusUserId,
        searchQuery,
        topics: ["project", "experience", "resume", "personal"],
        subTasks: [label],
        queryType,
        candidates: [],
    });
    const githubInHits = km.hits.flatMap((h) => [...h.excerpt.matchAll(GITHUB_RE)].map((m) => m[0]));
    console.log(`\n--- KM: ${label} ---`);
    console.log(`searchQuery=${searchQuery}`);
    console.log(`hitCount=${km.hits.length} coverage=${km.coverage}`);
    for (const h of km.hits.slice(0, 5)) {
        const urls = [...h.excerpt.matchAll(GITHUB_RE)].map((m) => m[0]);
        console.log(`  · ${basename(h.path)} urls=${urls.length ? urls.join(", ") : "(无 github.com)"}`);
    }
    return { km, githubInHits: [...new Set(githubInHits)] };
};

const intakeLive = async (
    userQuestion: string,
    history: DbChatTurn[],
    label: string
) => {
    console.log(`\n--- Intake live: ${label} ---`);
    console.log(`userQuestion=${JSON.stringify(userQuestion)}`);
    try {
        const raw = await completeIntakeCoordinator({ userQuestion, history });
        const { decision, earlyExit } = await runIntakePipeline({
            intakeRaw: raw,
            userQuestion,
            intakeHistory: history,
        });
        console.log(`intent=${decision.intent} earlyExit=${earlyExit} routeMode=${decision.routeMode ?? "?"}`);
        console.log(`searchQuery=${decision.searchQuery || "(空)"}`);
        console.log(`subTasks=${JSON.stringify(decision.subTasks)}`);
        console.log(`queryType=${decision.queryType ?? "null"}`);
        if (decision.clarifyingQuestion) {
            console.log(`clarifyingQuestion=${decision.clarifyingQuestion}`);
        }
        if (decision.compositeSlots?.length) {
            console.log(`compositeSlots=${decision.compositeSlots.length}`);
            for (const s of decision.compositeSlots) {
                console.log(`  · ${s.label} | ${s.searchQuery}`);
            }
        }
        return { decision, earlyExit };
    } catch (e) {
        console.log(`Intake 失败: ${e instanceof Error ? e.message : e}`);
        return null;
    }
};

const main = async () => {
    await bootstrapBrainServiceRuntime();
    const corpusUserId = await resolveCorpusUserId();
    console.log("diagnose-github-opensource-query");
    console.log(`corpusUserId=${corpusUserId}\n`);

    console.log("=== 1. 语料中所有 github.com URL ===");
    const corpusGithub = await scanGithubInCorpus(corpusUserId);
    if (corpusGithub.length === 0) {
        console.log("(语料中未发现 github.com URL)");
    } else {
        for (const row of corpusGithub) {
            console.log(`${basename(row.path)}: ${row.urls.join(" | ")}`);
        }
    }

    const iotPaths = [
        "aky-iotgeneraltemplate.md",
        "aky-222.md",
        "aky-deno-mylib.md",
        "2024-独立开源探索.md",
        "个人简历-潘展飞.md",
    ];
    console.log("\n=== 2. 用户点名的项目文档是否有 GitHub ===");
    for (const name of iotPaths) {
        const found = corpusGithub.find((r) => r.path.endsWith(name));
        console.log(`${name}: ${found ? found.urls.join(" | ") : "无 github.com"}`);
    }

    console.log("\n=== 3. KM 检索模拟（对话中的典型 query） ===");
    await kmProbe(corpusUserId, "轮2-简历GitHub链接", "简历 GitHub 开源项目 链接 release-bot sentinel", "enumeration");
    await kmProbe(corpusUserId, "轮4-物联网模板归档", "物联网模板归档 iotgeneraltemplate GitHub", "default");
    await kmProbe(corpusUserId, "轮4-工具库草稿", "工具库草稿 deno mylib GitHub", "default");
    await kmProbe(corpusUserId, "轮4-两个开源GitHub", "开源 GitHub 项目链接 物联网 工具库", "enumeration");
    await kmProbe(corpusUserId, "补充-简历对外链接", "个人简历 对外链接 GitHub sentinel release-bot", "identity");
    await kmProbe(corpusUserId, "补充-开源两款", "2024 独立开源 两款 开源项目 GitHub", "default");

    console.log("\n=== 4. Intake live（需 Ollama） ===");
    const h1: DbChatTurn[] = [
        { role: "user", content: "[2024-独立开源探索](../experience/2024-独立开源探索.md)" },
    ];
    await intakeLive(
        "我说的是简历里面的githup的项目链接",
        h1,
        "轮2"
    );

    const h2: DbChatTurn[] = [
        ...h1,
        {
            role: "assistant",
            content: "GitHub 项目链接：[panzhanfei/release-bot](https://github.com/panzhanfei/release-bot)",
        },
        { role: "user", content: "不止这一个" },
    ];
    await intakeLive("不止这一个", h2.slice(0, -1), "轮3");

    const h3: DbChatTurn[] = [
        ...h2,
        {
            role: "assistant",
            content: "你指的是哪些项目或经历？请提供更多细节以便我能更好地帮助你。",
        },
    ];
    await intakeLive(
        "他开源的两个项目的githup地址都给我\n1. 物联网模板归档项目GitHub地址\n2. 工具库草稿项目GitHub地址",
        h3,
        "轮4"
    );
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
