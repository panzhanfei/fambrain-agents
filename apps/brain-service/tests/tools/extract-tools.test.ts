import { describe, expect, it } from "vitest";
import type { KnowledgeHit } from "@/agentflow/agents/online/knowledge-manager";
import {
    buildExternalLinksAnswer,
    extractExternalLinksFromHits,
    extractUrlsFromText,
    resolveExternalLinkScope,
    resolveLinkTitle,
    scopeRequestsRepoHostOnly,
} from "@/agentflow/tools/lib/extract-external-links";
import {
    buildIdentityFieldAnswer,
    extractIdentityFieldFromHits,
    extractIdentityFieldFromText,
} from "@/agentflow/tools/lib/extract-identity-field";

const hit = (excerpt: string, path = "personal/resume.md"): KnowledgeHit => ({
    path,
    title: "resume",
    excerpt,
    relevance: 1,
});

describe("extractIdentityFieldFromText", () => {
    it("reads name from table row", () => {
        expect(
            extractIdentityFieldFromText("| 姓名 | 潘展飞 |", "name")
        ).toBe("潘展飞");
    });

    it("reads name from label line", () => {
        expect(extractIdentityFieldFromText("姓名：潘展飞", "name")).toBe(
            "潘展飞"
        );
    });
});

describe("extractIdentityFieldFromHits", () => {
    it("prefers personal resume path", () => {
        const result = extractIdentityFieldFromHits(
            [
                hit("| 姓名 | 其他 |", "project/foo.md"),
                hit("| 姓名 | 潘展飞 |", "personal/个人简历.md"),
            ],
            "name"
        );
        expect(result?.value).toBe("潘展飞");
    });
});

describe("buildIdentityFieldAnswer", () => {
    it("returns insufficient when missing", () => {
        const { answer, insufficientEvidence } = buildIdentityFieldAnswer({
            field: "name",
            extraction: null,
            language: "zh",
        });
        expect(insufficientEvidence).toBe(true);
        expect(answer).toMatch(/未检索到姓名/);
    });
});

describe("extractExternalLinks", () => {
    it("extracts github urls generically", () => {
        const urls = extractUrlsFromText(
            "仓库：https://github.com/org/repo 预览 https://example.com/app"
        );
        expect(urls).toContain("https://github.com/org/repo");
        expect(urls).toContain("https://example.com/app");
    });

    it("dedupes links across hits", () => {
        const links = extractExternalLinksFromHits([
            hit("GitHub: https://github.com/org/sentinel"),
            hit("同上 https://github.com/org/sentinel"),
        ]);
        expect(links).toHaveLength(1);
        expect(links[0]?.url).toBe("https://github.com/org/sentinel");
        expect(links[0]?.title).toBe("sentinel");
    });

    it("prefers line entity / markdown label over resume filename", () => {
        const excerpt = [
            "- Sentinel GitHub：<https://github.com/acme/sentinel-monorepo>",
            "- **对外链接**：GitHub [acme/release-bot](https://github.com/acme/release-bot)。",
        ].join("\n");
        expect(
            resolveLinkTitle(
                "https://github.com/acme/sentinel-monorepo",
                excerpt
            )
        ).toBe("Sentinel");
        expect(
            resolveLinkTitle("https://github.com/acme/release-bot", excerpt)
        ).toBe("release-bot");

        const { answer } = buildExternalLinksAnswer({
            links: extractExternalLinksFromHits([
                hit(excerpt, "personal/个人简历-某人.md"),
            ]),
            language: "zh",
        });
        expect(answer).toMatch(/Sentinel：https:\/\/github\.com\/acme\/sentinel/);
        expect(answer).toMatch(/release-bot：https:\/\/github\.com\/acme\/release-bot/);
        expect(answer).toMatch(/来源：个人简历-某人/);
        expect(answer).not.toMatch(/^1\.\s*个人简历/m);
    });

    it("filters Sentinel GitHub-only scope to one repo url", () => {
        const excerpt = [
            "- Sentinel GitHub：<https://github.com/acme/sentinel-monorepo>",
            "- Sentinel 线上预览：https://pzfnqbn.top/",
            "- **对外链接**：GitHub [acme/release-bot](https://github.com/acme/release-bot)。",
        ].join("\n");
        const scope = resolveExternalLinkScope(
            "开源项目的 GitHub 与线上地址",
            "Sentinel 项目的 GitHub 开源链接是什么？"
        );
        expect(scopeRequestsRepoHostOnly(scope)).toBe(true);

        const links = extractExternalLinksFromHits([hit(excerpt)], scope);
        expect(links).toHaveLength(1);
        expect(links[0]?.url).toBe("https://github.com/acme/sentinel-monorepo");
    });

    it("keeps multiple github links for generic open-source scope", () => {
        const excerpt = [
            "- Sentinel GitHub：<https://github.com/acme/sentinel-monorepo>",
            "- release-bot GitHub：<https://github.com/acme/release-bot>",
            "- Sentinel 线上预览：https://pzfnqbn.top/",
        ].join("\n");
        const scope = { label: "开源项目 GitHub 链接" };
        expect(scopeRequestsRepoHostOnly(scope)).toBe(true);
        const links = extractExternalLinksFromHits([hit(excerpt)], scope);
        expect(links.map((l) => l.url)).toEqual([
            "https://github.com/acme/sentinel-monorepo",
            "https://github.com/acme/release-bot",
        ]);
    });

    it("keeps github and preview when scope asks for both", () => {
        const excerpt = [
            "- Sentinel GitHub：<https://github.com/acme/sentinel-monorepo>",
            "- Sentinel 线上预览：https://pzfnqbn.top/",
        ].join("\n");
        const scope = { label: "Sentinel 的 GitHub 与线上地址" };
        const links = extractExternalLinksFromHits([hit(excerpt)], scope);
        expect(links.map((l) => l.url)).toEqual([
            "https://github.com/acme/sentinel-monorepo",
            "https://pzfnqbn.top/",
        ]);
    });
});
