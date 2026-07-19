import { describe, expect, it } from "vitest";
import {
    entryOverlapsTimeWindow,
    extractRoleFromExperienceBody,
} from "@/agentflow/agents/online/corpus-lister/list";

describe("entryOverlapsTimeWindow", () => {
    it("keeps entries with years inside window", () => {
        expect(
            entryOverlapsTimeWindow({
                path: "corpus/projects/foo.md",
                body: "时间段：2025.01 - 2026.03",
                timeWindowYears: 2,
                asOfDate: "2026-07-16",
            })
        ).toBe(true);
    });

    it("drops entries entirely before cutoff", () => {
        expect(
            entryOverlapsTimeWindow({
                path: "corpus/projects/old.md",
                body: "时间段：2018.01 - 2019.06",
                timeWindowYears: 2,
                asOfDate: "2026-07-16",
            })
        ).toBe(false);
    });

    it("keeps ongoing entries", () => {
        expect(
            entryOverlapsTimeWindow({
                path: "corpus/experience/2024-独立.md",
                body: "时间段：2024.10 - 至今",
                timeWindowYears: 2,
                asOfDate: "2026-07-16",
            })
        ).toBe(true);
    });
});

describe("extractRoleFromExperienceBody", () => {
    it("reads 角色 from experience markdown", () => {
        expect(
            extractRoleFromExperienceBody(
                "> **时间段**：2021.06 - 2024.09 · **角色**：前端小组组长\n"
            )
        ).toBe("前端小组组长");
    });
});
