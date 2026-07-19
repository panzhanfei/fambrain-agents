import { describe, expect, it } from "vitest";
import type { KnowledgeHit } from "@/agentflow/agents/online/knowledge-manager";
import {
    buildExternalLinksAnswer,
    extractExternalLinksFromHits,
    resolveExternalLinkScope,
} from "@/agentflow/tools/lib/extract-external-links";

const RESUME_EXCERPT = [
    "- Sentinel GitHub：<https://github.com/panzhanfei/sentinel-monorepo>",
    "- Sentinel 线上预览：https://pzfnqbn.top/",
    "- **对外链接**：GitHub [panzhanfei/release-bot](https://github.com/panzhanfei/release-bot)。",
].join("\n");

const resumeHit = (): KnowledgeHit => ({
    path: "personal/个人简历-潘展飞.md",
    title: "resume",
    excerpt: RESUME_EXCERPT,
    relevance: 1,
});

/** 与 runOrchestratedSubQuestion external_link 路径一致 */
const answerFor = (userQuestion: string) => {
    const scope = resolveExternalLinkScope(userQuestion, userQuestion);
    const links = extractExternalLinksFromHits([resumeHit()], scope);
    return buildExternalLinksAnswer({ links, language: "zh", scope });
};

describe("external link query regression (web session)", () => {
    it("Sentinel 项目的 GitHub 开源链接是什么？→ 仅 GitHub 仓库", () => {
        const { answer, insufficientEvidence } = answerFor(
            "Sentinel 项目的 GitHub 开源链接是什么？"
        );
        expect(insufficientEvidence).toBe(false);
        expect(answer).toMatch(
            /Sentinel：https:\/\/github\.com\/panzhanfei\/sentinel-monorepo/
        );
        expect(answer).not.toMatch(/pzfnqbn|release-bot/);
    });

    it("Sentinel 项目的 线上链接跟 GitHub 都给我 → GitHub + 线上预览", () => {
        const { answer, insufficientEvidence } = answerFor(
            "Sentinel 项目的 线上链接跟GitHub 都给我"
        );
        expect(insufficientEvidence).toBe(false);
        expect(answer).toMatch(
            /Sentinel：https:\/\/github\.com\/panzhanfei\/sentinel-monorepo/
        );
        expect(answer).toMatch(/Sentinel：https:\/\/pzfnqbn\.top\//);
        expect(answer).not.toMatch(/release-bot/);
    });

    it("我开源项目的 GitHub 地址都给我 → 全部 GitHub 仓库", () => {
        const { answer, insufficientEvidence } = answerFor(
            "我开源项目的GitHub地址都给我"
        );
        expect(insufficientEvidence).toBe(false);
        expect(answer).toMatch(
            /Sentinel：https:\/\/github\.com\/panzhanfei\/sentinel-monorepo/
        );
        expect(answer).toMatch(
            /release-bot：https:\/\/github\.com\/panzhanfei\/release-bot/
        );
        expect(answer).not.toMatch(/pzfnqbn/);
        expect(answer).not.toMatch(
            /未找到与「我开源项目的GitHub地址都给我」相关的 GitHub/
        );
    });
});
