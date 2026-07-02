/**
 * HY-01 BM25 sparse 检索验证（不依赖 Chroma）。
 *
 *   pnpm --filter @fambrain/brain-service run verify:sparse-recall
 */
import { buildBm25Index } from "@fambrain/corpus";
import { recallSparseRetrieve } from "@fambrain/corpus";
import { listCorpusUserIds } from "../src/agentflow/brain-service/offline/knowledge-indexer/list-corpus-users";

const assert = (name: string, fn: () => void) => {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${name}: ${msg}`);
        process.exitCode = 1;
    }
};

console.log("verify-sparse-recall\n— BM25 单元 —");

assert("BM25 相关 doc 得分高于无关 doc", () => {
    const docs = [
        ["城管", "平台", "技术", "栈", "vue", "react"],
        ["个人", "简历", "姓名", "潘展飞"],
        ["unrelated", "english", "only"],
    ];
    const bm25 = buildBm25Index(docs);
    const scores = bm25.score(["城管", "平台", "技术"]);
    if ((scores[0] ?? 0) <= (scores[2] ?? 0)) {
        throw new Error(`技术 doc 应最高，scores=${scores.join(",")}`);
    }
});

assert("空 query token 不崩溃", () => {
    const bm25 = buildBm25Index([["a", "b"]]);
    const scores = bm25.score([]);
    if (scores.length !== 1) throw new Error("应返回与 doc 数相同长度");
});

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv) return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) throw new Error("无 corpus 用户");
    return ids[0]!;
};

type LiveCase = {
    q: string;
    topPathRe: RegExp;
    label: string;
};

const liveCases: LiveCase[] = [
    {
        q: "个人简介 简历 姓名",
        topPathRe: /personal/i,
        label: "姓名",
    },
    {
        q: "我在哪几家公司上过班",
        topPathRe: /experience/i,
        label: "列举经历",
    },
    {
        q: "城管平台用了什么技术",
        topPathRe: /urban|城管|platform|project|experience|city|management/i,
        label: "项目技术",
    },
];

const main = async () => {
    const corpusUserId = await resolveCorpusUserId();
    let failed = 0;
    console.log(`\n— BM25 live corpusUserId=${corpusUserId} —`);

    for (const c of liveCases) {
        const hits = await recallSparseRetrieve(corpusUserId, c.q, 8);
        console.log(`\n${c.label}: "${c.q}" → ${hits.length} hits`);
        for (const [i, h] of hits.slice(0, 3).entries()) {
            console.log(
                `  ${i + 1}. ${h.path} score=${h.score.toFixed(3)} channel=${h.recallChannel}`
            );
        }
        const top = hits[0];
        if (!top || !c.topPathRe.test(top.path)) {
            failed++;
            console.log(`  ❌ Top1 未匹配 ${c.topPathRe}`);
        } else if (top.recallChannel !== "sparse") {
            failed++;
            console.log("  ❌ recallChannel 应为 sparse");
        } else {
            console.log("  ✅ OK");
        }
    }

    if (process.exitCode) {
        console.log("\nUNIT FAILED");
        process.exit(process.exitCode);
    }
    if (failed) {
        console.log(`\nLIVE FAILED ${failed}/${liveCases.length}`);
        process.exit(1);
    }
    console.log(`\nALL PASSED (${liveCases.length} live)`);
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
