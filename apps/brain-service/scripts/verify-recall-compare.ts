/**
 * HY-07：三问法 vector / sparse / RRF(hybrid) 对比验收。
 *
 *   pnpm --filter @fambrain/brain-service run verify:recall-compare
 *
 * Chroma + Ollama 在线时要求 recallSource=hybrid；未起时 sparse 段仍跑，hybrid 段 skip 并 exit 1。
 */
import { recallSparseRetrieve, searchCorpusVectors } from "@fambrain/corpus";
import { listCorpusUserIds } from "../src/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { hybridRecall } from "../src/agentflow/agents/online/knowledge-manager/recall/hybrid-recall";
import { getKmRetrievalConfig } from "../src/agentflow/agents/online/knowledge-manager/profile/km-config";

const TOP_K = 8;

type Case = {
    label: string;
    vectorQuery: string;
    sparseQuery: string;
    topPathRe: RegExp;
};

const cases: Case[] = [
    {
        label: "姓名",
        vectorQuery: "个人简介 简历 姓名",
        sparseQuery: "个人简介 简历 姓名",
        topPathRe: /personal/i,
    },
    {
        label: "列举经历",
        vectorQuery: "我在哪几家公司上过班",
        sparseQuery: "我在哪几家公司上过班",
        topPathRe: /experience/i,
    },
    {
        label: "项目技术",
        vectorQuery: "城管平台用了什么技术",
        sparseQuery: "城管平台用了什么技术",
        topPathRe: /urban|城管|platform|project|experience|city|management|aky/i,
    },
];

const chromaUrl = (): string => {
    const base =
        process.env.CHROMA_SERVER_URL?.trim() ||
        `http://${process.env.CHROMA_HOST ?? "127.0.0.1"}:${process.env.CHROMA_PORT ?? "8030"}`;
    return base.replace(/\/$/, "");
};

const chromaReady = async (): Promise<boolean> => {
    try {
        const res = await fetch(`${chromaUrl()}/api/v2/heartbeat`, {
            signal: AbortSignal.timeout(3000),
        });
        return res.ok;
    } catch {
        return false;
    }
};

const resolveCorpusUserId = async (): Promise<string> => {
    const fromEnv = process.env.FAMBRAIN_CORPUS_USER_ID?.trim();
    if (fromEnv) return fromEnv;
    const ids = await listCorpusUserIds();
    if (ids.length === 0) throw new Error("无 corpus 用户");
    return ids[0]!;
};

const topPaths = (paths: string[], n = 3): string[] => paths.slice(0, n);

const basename = (p: string): string => {
    const parts = p.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] ?? p;
};

const printRow = (
    channel: string,
    paths: string[],
    extra?: string
) => {
    const preview = topPaths(paths, 3)
        .map((p, i) => `${i + 1}.${basename(p)}`)
        .join(" | ");
    console.log(`  ${channel.padEnd(8)} ${preview}${extra ? `  (${extra})` : ""}`);
};

const unionCovers = (hybridTop: string[], singles: string[]): boolean => {
    const set = new Set(hybridTop);
    return singles.some((p) => set.has(p));
};

const main = async () => {
    const cfg = getKmRetrievalConfig();
    const corpusUserId = await resolveCorpusUserId();
    const chromaUp = await chromaReady();

    console.log("verify-recall-compare (HY-07)");
    console.log(`corpusUserId=${corpusUserId}`);
    console.log(`chroma=${chromaUp ? chromaUrl() : "DOWN"}`);
    console.log(
        `km: fetchMultiplier=${cfg.vectorFetchMultiplier} rrfK=${cfg.rrfK} weights=v${cfg.rrfVectorWeight}/s${cfg.rrfSparseWeight}\n`
    );

    let failed = 0;
    let hybridCases = 0;

    for (const c of cases) {
        console.log("─".repeat(60));
        console.log(`【${c.label}】 vector/sparse query`);

        let vectorPaths: string[] = [];
        let vectorError: string | null = null;
        if (chromaUp) {
            try {
                const vectorHits = await searchCorpusVectors(
                    corpusUserId,
                    c.vectorQuery,
                    TOP_K
                );
                vectorPaths = vectorHits.map((h) => h.path);
            } catch (e) {
                vectorError =
                    e instanceof Error ? e.message : String(e);
            }
        }

        const sparseHits = await recallSparseRetrieve(
            corpusUserId,
            c.sparseQuery,
            TOP_K
        );
        const sparsePaths = sparseHits.map((h) => h.path);

        const hybrid = await hybridRecall(
            corpusUserId,
            c.vectorQuery,
            c.sparseQuery,
            TOP_K
        );
        const hybridPaths = hybrid.candidates.map((x) => x.path);

        printRow(
            "vector",
            vectorPaths,
            chromaUp
                ? vectorError
                    ? `err: ${vectorError.slice(0, 40)}`
                    : `${vectorPaths.length} hits`
                : "skip"
        );
        printRow("sparse", sparsePaths, `${sparsePaths.length} hits`);
        printRow(
            "RRF",
            hybridPaths,
            `source=${hybrid.recallSource} v=${hybrid.vectorRawCount} s=${hybrid.sparseRawCount}`
        );

        const issues: string[] = [];

        if (sparsePaths.length === 0) {
            issues.push("sparse 无命中");
        } else if (!c.topPathRe.test(sparsePaths[0]!)) {
            issues.push(`sparse Top1 未匹配 ${c.topPathRe}`);
        }

        if (chromaUp) {
            hybridCases++;
            if (vectorPaths.length === 0 && !vectorError) {
                issues.push("vector 无命中（Chroma 已起）");
            }
            if (hybrid.recallSource !== "hybrid") {
                issues.push(
                    `期望 recallSource=hybrid，实际 ${hybrid.recallSource}`
                );
            }
            if (hybridPaths.length === 0) {
                issues.push("RRF 无候选");
            } else {
                const singles = [
                    vectorPaths[0],
                    sparsePaths[0],
                ].filter(Boolean) as string[];
                if (
                    singles.length > 0 &&
                    !unionCovers(topPaths(hybridPaths, 3), singles)
                ) {
                    issues.push("RRF Top3 未覆盖 vector/sparse 任一 Top1");
                }
                if (!c.topPathRe.test(hybridPaths[0]!)) {
                    issues.push(`RRF Top1 未匹配 ${c.topPathRe}`);
                }
            }
        }

        if (issues.length) {
            failed++;
            console.log("  ❌", issues.join("; "));
        } else {
            console.log("  ✅ OK");
        }
    }

    console.log("\n" + "─".repeat(60));
    if (!chromaUp) {
        console.log(
            "⚠️  Chroma 未起：仅验证 sparse + RRF(sparse-only)；请 bash scripts/index-corpus.sh 后重跑"
        );
        process.exit(1);
    }
    if (hybridCases < cases.length) {
        console.log("⚠️  hybrid 用例未全部执行");
        process.exit(1);
    }
    if (failed) {
        console.log(`FAILED ${failed}/${cases.length}`);
        process.exit(1);
    }
    console.log(`ALL ${cases.length} PASSED (vector + sparse + RRF hybrid)`);
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
