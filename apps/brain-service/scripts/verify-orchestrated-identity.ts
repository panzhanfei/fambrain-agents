/**
 * P0-23：identity 年龄走编排工具 compute_age_from_hits（非 LLM 推算）。
 *
 *   pnpm --filter @fambrain/brain-service run verify:orchestrated-identity
 */
import assert from "node:assert/strict";
import {
    computeAgeYears,
    extractBirthOrAgeFromText,
} from "../src/agentflow/tools/lib/compute-age";
import {
    resolveOrchestratedTool,
    runOrchestratedSubQuestion,
} from "../src/agentflow/tools/orchestrated/run-sub-question";
import { completeAnalyzeSubQuestion } from "../src/agentflow/agents/online/information-analyst/complete-analyze";
import type { KnowledgeHit } from "../src/agentflow/agents/online/knowledge-manager";

const ok = (msg: string) => console.log(`  ✓ ${msg}`);

const resumeHit = (excerpt: string): KnowledgeHit => ({
    path: "personal/个人简历-潘展飞.md",
    title: "个人简历",
    excerpt,
    relevance: 1,
});

console.log("verify-orchestrated-identity\n— extract birth —");

{
    const fromTable = extractBirthOrAgeFromText(
        "| 出生日期 | 1993.03 |\n| 年龄 | — |"
    );
    assert.equal(fromTable.birth?.year, 1993);
    assert.equal(fromTable.birth?.month, 3);
    ok("表格出生日期 1993.03");
}

{
    const explicit = extractBirthOrAgeFromText("| 年龄 | 32 |");
    assert.equal(explicit.explicitAge, 32);
    ok("表格原文年龄 32");
}

console.log("\n— computeAgeYears —");

{
    const age = computeAgeYears(
        { year: 1993, month: 3 },
        new Date("2026-07-09T12:00:00")
    );
    assert.equal(age, 33);
    ok("1993.03 → 33 岁（2026-07-09）");
}

console.log("\n— resolveOrchestratedTool —");

{
    const tool = resolveOrchestratedTool({
        userQuestion: "我今年多大",
        language: "zh",
        hits: [resumeHit("| 出生日期 | 1993.03 |")],
        coverage: "sufficient",
        notes: null,
        queryType: "identity",
    });
    assert.equal(tool, "compute_age_from_hits");
    ok("单问年龄 → compute_age_from_hits");
}

{
    const tool = resolveOrchestratedTool({
        userQuestion: "年龄",
        language: "zh",
        hits: [resumeHit("| 出生日期 | 1993.03 |")],
        coverage: "partial",
        notes: null,
        queryType: "identity",
    });
    assert.equal(tool, "compute_age_from_hits");
    ok("composite 槽 label=年龄 → compute_age_from_hits");
}

{
    const tool = resolveOrchestratedTool({
        userQuestion: "姓名",
        language: "zh",
        hits: [resumeHit("| 姓名 | 潘展飞 |")],
        coverage: "sufficient",
        notes: null,
        queryType: "identity",
        identityField: "name",
    });
    assert.equal(tool, "extract_identity_from_hits");
    ok("姓名槽 identityField=name → extract_identity_from_hits");
}

{
    const tool = resolveOrchestratedTool({
        userQuestion: "姓名",
        language: "zh",
        hits: [resumeHit("| 姓名 | 潘展飞 |")],
        coverage: "sufficient",
        notes: null,
        queryType: "identity",
    });
    assert.equal(tool, null);
    ok("无 identityField 的 identity 槽不走 name 工具");
}

{
    const tool = resolveOrchestratedTool({
        userQuestion: "开源链接",
        language: "zh",
        hits: [resumeHit("https://github.com/org/repo")],
        coverage: "sufficient",
        notes: null,
        queryType: "external_link",
    });
    assert.equal(tool, "extract_external_links_from_hits");
    ok("external_link → extract_external_links_from_hits");
}

console.log("\n— runOrchestratedSubQuestion —");

{
    const result = runOrchestratedSubQuestion({
        userQuestion: "我今年多大",
        language: "zh",
        hits: [resumeHit("| 出生日期 | 1993.03 |")],
        coverage: "sufficient",
        notes: null,
        queryType: "identity",
        asOfDate: "2026-07-09",
    });
    assert.ok(result);
    assert.match(result.answer, /33\s*岁/);
    assert.equal(result.insufficientEvidence, false);
    assert.ok(result.citations.length >= 1);
    ok(`出生推算: ${result.answer}`);
}

{
    const result = runOrchestratedSubQuestion({
        userQuestion: "我今年多大",
        language: "zh",
        hits: [resumeHit("职业：前端工程师")],
        coverage: "partial",
        notes: null,
        queryType: "identity",
    });
    assert.ok(result);
    assert.equal(result.insufficientEvidence, true);
    assert.match(result.answer, /未标注当前年龄/);
    ok("无出生字段 → insufficient 兜底");
}

{
    const result = runOrchestratedSubQuestion({
        userQuestion: "姓名",
        language: "zh",
        hits: [resumeHit("| 姓名 | 潘展飞 |")],
        coverage: "sufficient",
        notes: null,
        queryType: "identity",
        identityField: "name",
    });
    assert.ok(result);
    assert.equal(result.answer, "潘展飞");
    assert.equal(result.insufficientEvidence, false);
    ok(`姓名抽取: ${result.answer}`);
}

{
    const result = runOrchestratedSubQuestion({
        userQuestion: "开源 GitHub",
        language: "zh",
        hits: [
            resumeHit(
                "Sentinel 开源仓库 https://github.com/org/sentinel 线上 https://sentinel.example.com"
            ),
        ],
        coverage: "sufficient",
        notes: null,
        queryType: "external_link",
    });
    assert.ok(result);
    assert.match(result.answer, /github\.com\/org\/sentinel/);
    assert.equal(result.insufficientEvidence, false);
    ok("外链抽取含 GitHub URL");
}

console.log("\n— completeAnalyzeSubQuestion skip LLM —");

{
    const result = await completeAnalyzeSubQuestion({
        userQuestion: "我今年多大",
        language: "zh",
        hits: [resumeHit("| 出生日期 | 1993.03 |")],
        coverage: "sufficient",
        notes: null,
        queryType: "identity",
        asOfDate: "2026-07-09",
    });
    assert.match(result.answer, /33\s*岁/);
    assert.equal(result.insufficientEvidence, false);
    ok("Analyst 子问路径跳过 LLM，直出周岁");
}

console.log("\n— search_web stub (registry) —");

{
    const { searchWebTool, FAMBRAIN_TOOL_NAMES } = await import(
        "../src/agentflow/tools"
    );
    assert.ok(FAMBRAIN_TOOL_NAMES.includes("search_web"));
    assert.ok(FAMBRAIN_TOOL_NAMES.includes("compute_age_from_hits"));
    const raw = await searchWebTool.invoke({ query: "奥卡云 公司背景" });
    const parsed = JSON.parse(String(raw)) as { status: string };
    assert.equal(parsed.status, "disabled");
    ok("search_web 已注册且默认 disabled");
}

console.log("\nOK");
