/**
 * Intake 对外链接 — pipeline 单测 + KM live（档 B：信 LLM plan，不发明拆槽）。
 *
 *   pnpm --filter @fambrain/brain-service run verify:intake-link-lookup
 */
import type { DbChatTurn } from "@fambrain/brain-types";
import { runIntakePipeline } from "../src/agentflow/agents/online/intake-coordinator/pipeline/intake-pipeline";
import { listCorpusUserIds } from "../src/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { retrieveKnowledge } from "../src/agentflow/agents/online/knowledge-manager/recall/retrieve";
import { bootstrapBrainServiceRuntime } from "../src/config/index";

const GITHUB_RE = /https?:\/\/github\.com\/[^\s)>]+/gi;

const assertCase = async (name: string, fn: () => void | Promise<void>) => {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${name}: ${msg}`);
        process.exitCode = 1;
    }
};

const externalLinkJson = JSON.stringify({
    intent: "retrieve_and_answer",
    searchQuery: "个人简介 简历 开源 对外链接 GitHub",
    subTasks: ["开源项目 GitHub"],
    topics: ["personal", "resume", "project"],
    language: "zh",
    confidence: 0.88,
    queryType: "external_link",
    clarifyingQuestion: null,
    briefReply: null,
    retrievalPlan: [
        {
            label: "开源项目 GitHub",
            searchQuery: "个人简介 简历 开源 对外链接 GitHub",
            queryType: "external_link",
            topics: ["personal", "resume", "project"],
        },
    ],
    userFactKey: null,
    userFactLabel: null,
    userFactValue: null,
});

const clarifyContinuationJson = JSON.stringify({
    intent: "clarify",
    searchQuery: "",
    subTasks: [],
    topics: ["project"],
    language: "zh",
    confidence: 0.55,
    queryType: null,
    clarifyingQuestion: "你指的是哪些项目或经历？",
    briefReply: null,
    retrievalPlan: [],
    userFactKey: null,
    userFactLabel: null,
    userFactValue: null,
});

console.log("verify-intake-link-lookup\n— pipeline 单测 —");

await assertCase("Intake LLM 声明 external_link + 1 项 plan → 保留路由", async () => {
    const { decision, earlyExit } = await runIntakePipeline({
        intakeRaw: externalLinkJson,
        userQuestion: "我说的是简历里面的 GitHub 的项目链接",
        intakeHistory: [
            {
                role: "user",
                content: "[2024-独立开源探索](../experience/2024-独立开源探索.md)",
            },
        ],
    });
    if (earlyExit) throw new Error("不应早退");
    if (decision.queryType !== "external_link") {
        throw new Error(`期望 external_link，实际 ${decision.queryType}`);
    }
    if (decision.routeMode !== "slots") {
        throw new Error(`期望 slots，实际 ${decision.routeMode}`);
    }
    if ((decision.compositeSlots?.length ?? 0) !== 1) {
        throw new Error(`期望 1 槽，实际 ${decision.compositeSlots?.length}`);
    }
    if (!decision.topics.includes("personal")) {
        throw new Error(`topics 应含 personal: ${decision.topics.join(",")}`);
    }
});

await assertCase("retrieve 空 plan → clarify 早退", async () => {
    const { decision, earlyExit } = await runIntakePipeline({
        intakeRaw: JSON.stringify({
            intent: "retrieve_and_answer",
            searchQuery: "简历 GitHub",
            subTasks: [],
            topics: ["personal"],
            language: "zh",
            confidence: 0.8,
            queryType: "external_link",
            clarifyingQuestion: null,
            briefReply: null,
            retrievalPlan: [],
            userFactKey: null,
            userFactLabel: null,
            userFactValue: null,
        }),
        userQuestion: "简历里的 GitHub 链接",
        intakeHistory: [],
    });
    if (!earlyExit) throw new Error("空 plan 应 clarify 早退");
    if (decision.intent !== "clarify") {
        throw new Error(`期望 clarify，实际 ${decision.intent}`);
    }
});

await assertCase("「不止这一个」+ LLM 标 clarify → 信 clarify 早退", async () => {
    const history: DbChatTurn[] = [
        {
            role: "user",
            content: "我说的是简历里面的 GitHub 的项目链接",
        },
        {
            role: "assistant",
            content:
                "GitHub 项目链接：[panzhanfei/release-bot](https://github.com/panzhanfei/release-bot)",
        },
        { role: "user", content: "不止这一个" },
    ];
    const { decision, earlyExit } = await runIntakePipeline({
        intakeRaw: clarifyContinuationJson,
        userQuestion: "不止这一个",
        intakeHistory: history.slice(0, -1),
    });
    if (!earlyExit) throw new Error("档 B：LLM 标 clarify 应早退");
    if (decision.intent !== "clarify") {
        throw new Error(`期望 clarify，实际 ${decision.intent}`);
    }
});

await assertCase(
    "「不止这一个」+ LLM 已写齐 external_link plan → 检索",
    async () => {
        const history: DbChatTurn[] = [
            {
                role: "user",
                content: "我说的是简历里面的 GitHub 的项目链接",
            },
            {
                role: "assistant",
                content:
                    "GitHub 项目链接：[panzhanfei/release-bot](https://github.com/panzhanfei/release-bot)",
            },
        ];
        const intakeRaw = JSON.stringify({
            intent: "retrieve_and_answer",
            searchQuery: "个人简介 简历 开源 对外链接 GitHub",
            subTasks: ["开源项目 GitHub"],
            topics: ["personal", "resume", "project"],
            language: "zh",
            confidence: 0.85,
            queryType: "external_link",
            clarifyingQuestion: null,
            briefReply: null,
            retrievalPlan: [
                {
                    label: "开源项目 GitHub",
                    searchQuery: "个人简介 简历 开源 对外链接 GitHub",
                    queryType: "external_link",
                    topics: ["personal", "resume", "project"],
                },
            ],
            userFactKey: null,
            userFactLabel: null,
            userFactValue: null,
        });
        const { decision, earlyExit } = await runIntakePipeline({
            intakeRaw,
            userQuestion: "不止这一个",
            intakeHistory: history,
        });
        if (earlyExit) throw new Error("已有 plan 不应早退");
        if (decision.intent !== "retrieve_and_answer") {
            throw new Error(`期望 retrieve，实际 ${decision.intent}`);
        }
        if (decision.queryType !== "external_link") {
            throw new Error(`期望 external_link，实际 ${decision.queryType}`);
        }
    }
);

await assertCase("泛化问法：LLM 写 1 项 plan → 单槽（不继承旧多槽）", async () => {
    const userQuestion = "开源了两个项目的github地址都给我";
    const intakeRaw = JSON.stringify({
        intent: "retrieve_and_answer",
        searchQuery: "个人简介 简历 开源 对外链接 GitHub",
        subTasks: ["开源项目 GitHub 链接"],
        topics: ["personal", "resume", "project"],
        language: "zh",
        confidence: 0.85,
        queryType: "external_link",
        clarifyingQuestion: null,
        briefReply: null,
        retrievalPlan: [
            {
                label: "开源项目 GitHub 链接",
                searchQuery: "个人简介 简历 开源 对外链接 GitHub",
                queryType: "external_link",
                topics: ["personal", "resume", "project"],
            },
        ],
        userFactKey: null,
        userFactLabel: null,
        userFactValue: null,
    });
    const { decision, earlyExit } = await runIntakePipeline({
        intakeRaw,
        userQuestion,
        intakeHistory: [
            {
                role: "user",
                content:
                    "1. 物联网模板归档项目GitHub地址\n2. 工具库草稿项目GitHub地址",
            },
        ],
    });
    if (earlyExit) throw new Error("不应早退");
    if ((decision.compositeSlots?.length ?? 0) !== 1) {
        throw new Error(
            `期望 1 槽（信本轮 LLM plan），实际 ${decision.compositeSlots?.length ?? 0}`
        );
    }
    if (decision.queryType !== "external_link") {
        throw new Error(`期望 external_link，实际 ${decision.queryType}`);
    }
});

await assertCase(
    "混合问：enumeration + external_link → 保留双槽",
    async () => {
        const userQuestion =
            "帮我列出 所有我做过的项目，并且告诉我 其中开源项目的githup地址跟线上地址";
        const intakeRaw = JSON.stringify({
            intent: "retrieve_and_answer",
            searchQuery: "项目经历 全部项目 开源 GitHub",
            subTasks: ["列举所有项目名称", "开源项目的 GitHub 与线上地址"],
            topics: ["project", "tech-stack"],
            language: "zh",
            confidence: 0.9,
            queryType: "enumeration",
            clarifyingQuestion: null,
            briefReply: null,
            retrievalPlan: [
                {
                    label: "列举所有项目名称",
                    searchQuery: "项目经历 全部项目 项目名称",
                    queryType: "enumeration",
                    topics: ["project", "tech-stack"],
                    enumerationControl: {
                        action: "preview",
                        listKind: "project",
                    },
                },
                {
                    label: "开源项目的 GitHub 与线上地址",
                    searchQuery:
                        "个人简介 简历 开源 对外链接 仓库地址 线上预览 URL GitHub",
                    queryType: "external_link",
                    topics: ["personal", "resume", "project"],
                },
            ],
            userFactKey: null,
            userFactLabel: null,
            userFactValue: null,
        });
        const { decision, earlyExit } = await runIntakePipeline({
            intakeRaw,
            userQuestion,
            intakeHistory: [],
        });
        if (earlyExit) throw new Error("不应早退");
        const slots = decision.compositeSlots ?? [];
        if (slots.length < 2) {
            throw new Error(`期望 ≥2 槽，实际 ${slots.length}`);
        }
        const linkSlot = slots.find((s) => s.queryType === "external_link");
        if (!linkSlot) {
            throw new Error(
                `应含 external_link 槽: ${slots.map((s) => s.queryType).join(",")}`
            );
        }
        if (!linkSlot.searchQuery.includes("开源")) {
            throw new Error(
                `应保留 LLM searchQuery: ${linkSlot.searchQuery}`
            );
        }
    }
);

await assertCase(
    "混合问：双 enumeration 无 sibling link → 不口语改成 external_link",
    async () => {
        const userQuestion =
            "帮我列出 所有我做过的项目，并且告诉我 他开源项目的githup地址跟线上地址";
        const intakeRaw = JSON.stringify({
            intent: "retrieve_and_answer",
            searchQuery: "所有项目 开源 GitHub 线上地址",
            subTasks: ["列举所有项目名称", "提供每个项目的GitHub地址及线上地址"],
            topics: ["project", "personal"],
            language: "zh",
            confidence: 0.86,
            queryType: "enumeration",
            clarifyingQuestion: null,
            briefReply: null,
            retrievalPlan: [
                {
                    label: "列举所有项目名称和简要描述",
                    searchQuery: "所有项目名称 项目经历",
                    queryType: "enumeration",
                    topics: ["project"],
                    enumerationControl: {
                        action: "preview",
                        listKind: "project",
                    },
                },
                {
                    label: "提供每个项目的GitHub地址及线上地址",
                    searchQuery: "开源项目 GitHub 线上地址",
                    queryType: "enumeration",
                    topics: ["project"],
                },
            ],
            userFactKey: null,
            userFactLabel: null,
            userFactValue: null,
        });
        const { decision, earlyExit } = await runIntakePipeline({
            intakeRaw,
            userQuestion,
            intakeHistory: [],
        });
        if (earlyExit) throw new Error("不应早退");
        const slots = decision.compositeSlots ?? [];
        if (slots.length < 1) {
            throw new Error(`期望 ≥1 槽，实际 ${slots.length}`);
        }
        const types = slots.map((s) => s.queryType);
        if (!types.every((t) => t === "enumeration")) {
            throw new Error(
                `无 sibling external_link 时不应口语纠偏: ${types.join(",")}`
            );
        }
    }
);

await assertCase(
    "顶层 external_link + plan 项误标 enumeration → harmonize",
    async () => {
        const userQuestion = "简历里的 GitHub 链接给我";
        const intakeRaw = JSON.stringify({
            intent: "retrieve_and_answer",
            searchQuery: "简历 GitHub",
            subTasks: ["对外链接"],
            topics: ["personal", "resume"],
            language: "zh",
            confidence: 0.9,
            queryType: "external_link",
            clarifyingQuestion: null,
            briefReply: null,
            retrievalPlan: [
                {
                    label: "对外链接",
                    searchQuery: "GitHub 链接",
                    queryType: "enumeration",
                    topics: ["personal", "resume"],
                },
            ],
            userFactKey: null,
            userFactLabel: null,
            userFactValue: null,
        });
        const { decision, earlyExit } = await runIntakePipeline({
            intakeRaw,
            userQuestion,
            intakeHistory: [],
        });
        if (earlyExit) throw new Error("不应早退");
        const slots = decision.compositeSlots ?? [];
        if (!slots.some((s) => s.queryType === "external_link")) {
            throw new Error(
                `应纠偏为 external_link: ${slots.map((s) => s.queryType).join(",")}`
            );
        }
    }
);

await assertCase("编号双问：LLM 写 2 项 plan → 2 槽", async () => {
    const userQuestion =
        "他开源的两个项目的 GitHub 地址都给我\n1. 物联网模板归档项目GitHub地址\n2. 工具库草稿项目GitHub地址";
    const intakeRaw = JSON.stringify({
        intent: "retrieve_and_answer",
        searchQuery: "开源 GitHub 项目链接",
        subTasks: ["物联网模板归档", "工具库草稿"],
        topics: ["project"],
        language: "zh",
        confidence: 0.85,
        queryType: "external_link",
        clarifyingQuestion: null,
        briefReply: null,
        retrievalPlan: [
            {
                label: "物联网模板归档项目GitHub地址",
                searchQuery:
                    "物联网模板归档 个人简介 简历 GitHub 仓库 对外链接",
                queryType: "external_link",
                topics: ["personal", "resume", "project"],
            },
            {
                label: "工具库草稿项目GitHub地址",
                searchQuery: "工具库草稿 个人简介 简历 GitHub 仓库 对外链接",
                queryType: "external_link",
                topics: ["personal", "resume", "project"],
            },
        ],
        userFactKey: null,
        userFactLabel: null,
        userFactValue: null,
    });
    const { decision, earlyExit } = await runIntakePipeline({
        intakeRaw,
        userQuestion,
        intakeHistory: [],
    });
    if (earlyExit) throw new Error("不应早退");
    const slots = decision.compositeSlots ?? [];
    if (slots.length !== 2) {
        throw new Error(`期望 2 槽，实际 ${slots.length}`);
    }
    if (slots.some((s) => s.queryType !== "external_link")) {
        throw new Error(
            `各槽应为 external_link: ${slots.map((s) => s.queryType).join(",")}`
        );
    }
});

await bootstrapBrainServiceRuntime();

console.log("\n— KM live（external_link 应含 github.com excerpt）—");

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv) return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) throw new Error("无 corpus 用户");
    return ids[0]!;
};

try {
    const corpusUserId = await resolveCorpusUserId();
    const km = await retrieveKnowledge({
        corpusUserId,
        searchQuery: "个人简介 简历 对外链接 仓库地址 线上预览 URL",
        topics: ["personal", "resume", "project"],
        subTasks: ["对外链接列举"],
        queryType: "external_link",
        candidates: [],
    });
    const urls = [
        ...new Set(
            km.hits.flatMap((h) => [...h.excerpt.matchAll(GITHUB_RE)].map((m) => m[0]))
        ),
    ];
    console.log(`  hitCount=${km.hits.length} githubUrls=${urls.length}`);
    for (const u of urls) console.log(`    · ${u}`);
    if (urls.length < 2) {
        console.error(
            `  ✗ external_link 检索应至少 2 个 GitHub URL，实际 ${urls.length}`
        );
        process.exitCode = 1;
    } else {
        console.log("  ✓ external_link KM 含 ≥2 GitHub URL");
    }
    const top = km.hits[0]?.path.split("/").pop() ?? "";
    if (!/简历|release-bot|sentinel/i.test(top)) {
        console.error(`  ✗ top hit 异常: ${top}`);
        process.exitCode = 1;
    } else {
        console.log(`  ✓ top hit 合理: ${top}`);
    }
} catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ KM live: ${msg}`);
    process.exitCode = 1;
}

if (process.exitCode) {
    console.log("\nverify-intake-link-lookup FAILED");
    process.exit(process.exitCode);
}
console.log("\nverify-intake-link-lookup OK");
