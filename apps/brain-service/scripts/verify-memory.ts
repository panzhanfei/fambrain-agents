/**
 * Mem0 + LangMem 本地验证（需 Ollama；Mem0 可设 MEM0_ENABLED=false 仅测 LangMem）。
 *
 *   pnpm run verify:memory
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const main = async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fambrain-mem-"));
    process.env.LANGMEM_SESSIONS_DIR = tmp;
    process.env.MEM0_ENABLED = "false";
    const { buildMemoryPromptBlock, preparePipelineMemory, resetMemoryConfigCache, } = await import("@fambrain/brain-memory");
    const { summarizeSessionTurns } = await import("@fambrain/brain-memory/langmem");
    resetMemoryConfigCache();
    const block = buildMemoryPromptBlock({
        sessionSummary: "用户刚问过城管平台技术栈。",
        userMemories: ["偏好简洁中文回答"],
    });
    assert.ok(block);
    assert.ok(block!.includes("LangMem"));
    assert.ok(block!.includes("Mem0"));
    console.log("✓ buildMemoryPromptBlock");
    const summary = await summarizeSessionTurns(null, [
        { role: "user", content: "我是前端开发，主要用 React。" },
        { role: "assistant", content: "好的，已了解你的技术方向。" },
    ]);
    assert.ok(summary.length > 5);
    console.log("✓ LangMem summarizeSessionTurns");
    const ctx = await preparePipelineMemory({
        context: {
            actorUserId: "user-test",
            corpusUserId: "user-test",
            displayName: "Test",
            conversationId: "conv-test",
        },
        history: [{ role: "user", content: "你好" }],
        userQuestion: "你好",
    });
    assert.equal(ctx.userMemories.length, 0);
    assert.ok(Array.isArray(ctx.intakeHistory));
    console.log("✓ preparePipelineMemory (Mem0 off)");
    await rm(tmp, { recursive: true, force: true });
    console.log("\nverify:memory OK");
};
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
