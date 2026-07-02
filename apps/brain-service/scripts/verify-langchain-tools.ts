/**
 * LangChain StructuredTool 层验证（不替换主 pipeline）。
 *
 *   pnpm --filter @fambrain/brain-service run verify:langchain-tools
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const chromaReady = async (url: string): Promise<boolean> => {
    try {
        const res = await fetch(`${url}/api/v2/heartbeat`, {
            signal: AbortSignal.timeout(3000),
        });
        return res.ok;
    } catch {
        return false;
    }
};

const ok = (msg: string) => console.log(`  ✓ ${msg}`);

const main = async (): Promise<void> => {
    console.log("verify:langchain-tools\n— registry —");

    const { createFambrainTools, FAMBRAIN_TOOL_NAMES } = await import(
        "@/agentflow/tools"
    );
    const tools = createFambrainTools();
    assert.equal(tools.length, FAMBRAIN_TOOL_NAMES.length);
    for (const name of FAMBRAIN_TOOL_NAMES) {
        const t = tools.find((x) => x.name === name);
        assert.ok(t, `缺少 tool: ${name}`);
        assert.ok(t.description.length > 10, `${name} 应有 description`);
    }
    ok(`${tools.length} 个 StructuredTool 已注册`);

    console.log("\n— retrieve_corpus (live, 需 Chroma) —");

    const { bootstrapBrainServiceRuntime } = await import("@/config");
    bootstrapBrainServiceRuntime();

    const { listCorpusUserIds } = await import(
        "@/agentflow/brain-service/offline/knowledge-indexer/list-corpus-users"
    );
    const { getChromaServerUrl } = await import("@fambrain/corpus");
    const { retrieveCorpusTool, runWithToolContext } = await import(
        "@/agentflow/tools"
    );

    const corpusUserId =
        process.env.FAMBRAIN_CORPUS_USER_ID?.trim() ||
        (await listCorpusUserIds())[0];

    if (!corpusUserId) {
        console.log("  (skip) 无 corpus 用户");
    } else if (!(await chromaReady(getChromaServerUrl()))) {
        console.log("  (skip) Chroma 未启动");
    } else {
        const raw = await runWithToolContext(
            { corpusUserId, actorUserId: corpusUserId },
            () =>
                retrieveCorpusTool.invoke({
                    searchQuery: "个人简介 简历 姓名",
                    queryType: "identity",
                })
        );
        const parsed = JSON.parse(String(raw)) as {
            hitCount: number;
            paths: { path: string }[];
        };
        assert.ok(parsed.hitCount >= 1, "应有 hits");
        assert.match(parsed.paths[0]?.path ?? "", /personal/i);
        ok(`retrieve_corpus hits=${parsed.hitCount} top=${parsed.paths[0]?.path}`);
    }

    console.log("\n— remember / recall (live, 需 Mem0 + Ollama) —");

    if (process.env.MEM0_ENABLED === "0" || process.env.MEM0_ENABLED === "false") {
        console.log("  (skip) MEM0_ENABLED=false");
    } else {
        const tmp = await mkdtemp(path.join(os.tmpdir(), "fambrain-lc-mem-"));
        process.env.MEM0_HISTORY_DB_PATH = path.join(tmp, "history.db");
        process.env.LANGMEM_ENABLED = "false";
        const { resetMemoryConfigCache } = await import("@fambrain/brain-memory");
        resetMemoryConfigCache();

        const {
            rememberUserFactTool,
            recallUserFactTool,
            runWithToolContext,
        } = await import("@/agentflow/tools");

        const userId = `lc-tool-${Date.now()}`;
        const qq = "734858469";

        await runWithToolContext(
            { corpusUserId: userId, actorUserId: userId },
            () =>
                rememberUserFactTool.invoke({
                    factKey: "qq",
                    label: "QQ号",
                    value: qq,
                })
        );

        const recallRaw = await runWithToolContext(
            { corpusUserId: userId, actorUserId: userId },
            () =>
                recallUserFactTool.invoke({
                    factKey: "qq",
                    label: "QQ号",
                    userQuestion: "我的qq是多少",
                })
        );
        const recall = JSON.parse(String(recallRaw)) as {
            found: boolean;
            value: string | null;
        };
        assert.equal(recall.found, true);
        assert.equal(recall.value, qq);
        ok("remember → recall 往返");

        await rm(tmp, { recursive: true, force: true });
    }

    console.log("\n— list_vault_files —");

    {
        const tmp = await mkdtemp(path.join(os.tmpdir(), "fambrain-lc-tool-"));
        const userId = "tool-user";
        const uploads = path.join(
            tmp,
            "users",
            userId,
            "vault",
            "originals",
            "uploads"
        );
        await mkdir(uploads, { recursive: true });
        await writeFile(path.join(uploads, "note.pdf"), "bytes");
        const prev = process.env.FAMBRAIN_DOC_ROOT_OVERRIDE;
        process.env.FAMBRAIN_DOC_ROOT_OVERRIDE = tmp;
        try {
            const { listVaultFilesTool } = await import(
                "@/agentflow/tools/list-vault"
            );
            const { runWithToolContext } = await import(
                "@/agentflow/tools/context"
            );
            const raw = await runWithToolContext(
                { corpusUserId: userId, actorUserId: userId },
                () => listVaultFilesTool.invoke({ userId })
            );
            const parsed = JSON.parse(String(raw)) as { count: number };
            assert.equal(parsed.count, 1);
            ok("invoke 返回 vault 文件数");
        } finally {
            if (prev === undefined) delete process.env.FAMBRAIN_DOC_ROOT_OVERRIDE;
            else process.env.FAMBRAIN_DOC_ROOT_OVERRIDE = prev;
            await rm(tmp, { recursive: true, force: true });
        }
    }

    console.log("\nOK");
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
