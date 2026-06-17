/**
 * KM 在线自测：真实语料 + Chroma（可用时）/ 扫盘 fallback。
 *
 *   FAMBRAIN_CORPUS_USER_ID=xxx pnpm --filter @fambrain/agents run verify:km-retrieve:live
 */
import { listCorpusUserIds } from "../src/agentflow/agents/offline/knowledge-indexer/list-corpus-users.ts";
import { getProfileRecallParams } from "../src/agentflow/agents/online/knowledge-manager/km-config.ts";
import {
    inferQueryProfile,
    resolveQueryProfile,
} from "../src/agentflow/agents/online/knowledge-manager/query-profile.ts";
import { retrieveKnowledge } from "../src/agentflow/agents/online/knowledge-manager/retrieve.ts";

type Case = {
    q: string;
    queryType: "identity" | "enumeration" | "tech" | "default";
    expectProfile: "identity" | "enumeration" | "tech" | "default";
    label?: string;
    optional?: boolean;
    minHits?: number;
    topPathRe?: RegExp;
    notPathRe?: RegExp;
};

const cases: Case[] = [
    {
        q: "个人简介 简历 姓名",
        queryType: "identity",
        expectProfile: "identity",
        topPathRe: /personal/i,
        notPathRe: /projects\/resume|_TEMPLATE/i,
        label: "姓名（Intake 改写 searchQuery）",
    },
    {
        q: "我的名字是什么？",
        queryType: "identity",
        expectProfile: "identity",
        label: "姓名（原始问法，依赖 KM-11 identityGuard）",
        optional: true,
    },
    {
        q: "我在哪几家公司上过班？",
        queryType: "enumeration",
        expectProfile: "enumeration",
        minHits: 2,
    },
    {
        q: "城管平台用了什么技术？",
        queryType: "tech",
        expectProfile: "tech",
        topPathRe: /urban|城管|platform|project|experience|city|management/i,
    },
    {
        q: "介绍一下西安奥卡云的工作经历",
        queryType: "default",
        expectProfile: "default",
    },
];

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv) return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) throw new Error("无 corpus 用户");
    return ids[0]!;
};

const main = async () => {
    const corpusUserId = await resolveCorpusUserId();
    let failed = 0;
    console.log(`KM live 自测 corpusUserId=${corpusUserId}\n`);

    for (const c of cases) {
        const inferred = inferQueryProfile(c.q, []);
        const profile = resolveQueryProfile(c.q, [], c.queryType);
        const params = getProfileRecallParams(profile);
        console.log("─".repeat(60));
        console.log("Q:", c.label ?? c.q);
        if (c.label) console.log("  searchQuery:", c.q);
        console.log(
            "  queryType:",
            c.queryType,
            "| infer:",
            inferred,
            "| resolve:",
            profile,
            "| params:",
            params
        );

        const t0 = Date.now();
        const r = await retrieveKnowledge({
            corpusUserId,
            searchQuery: c.q,
            topics: [],
            subTasks: [],
            queryType: c.queryType,
            candidates: [],
        });
        const ms = Date.now() - t0;

        console.log("  latencyMs:", ms);
        console.log("  coverage:", r.coverage, "| hits:", r.hits.length);
        for (const [i, h] of r.hits.entries()) {
            console.log(`  hit${i + 1}: ${h.path} (rel=${h.relevance.toFixed(3)})`);
        }
        if (r.hits[0]) {
            console.log(
                "  excerpt:",
                r.hits[0].excerpt.slice(0, 100).replace(/\s+/g, " ")
            );
        }

        const issues: string[] = [];
        if (profile !== c.expectProfile) {
            issues.push(`profile 期望 ${c.expectProfile} 实际 ${profile}`);
        }
        if (c.minHits !== undefined && r.hits.length < c.minHits) {
            issues.push(`hits 期望 >=${c.minHits} 实际 ${r.hits.length}`);
        }
        if (c.topPathRe && r.hits[0] && !c.topPathRe.test(r.hits[0].path)) {
            issues.push(`Top1 path 未匹配 ${c.topPathRe}`);
        }
        if (c.notPathRe && r.hits[0] && c.notPathRe.test(r.hits[0].path)) {
            issues.push(`Top1 不应为 ${r.hits[0].path}`);
        }
        if (r.hits.length === 0) issues.push("hits 为空");

        if (issues.length) {
            if (c.optional) {
                console.log("  ⚠️  已知差距（optional）:", issues.join("; "));
            } else {
                failed++;
                console.log("  ❌", issues.join("; "));
            }
        } else {
            console.log("  ✅ OK");
        }
    }

    console.log(
        failed ? `\nFAILED ${failed}/${cases.length}` : `\nALL ${cases.length} PASSED`
    );
    if (failed) process.exit(1);
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
