import { describe, expect, it } from "vitest";
import {
    buildTenureAnswer,
    computeTenureYearsMonths,
    extractTenureFromHits,
    parseTenureRangesFromText,
} from "@/agentflow/tools/lib/compute-tenure";

describe("parseTenureRangesFromText", () => {
    it("parses resume timeline table rows", () => {
        const text = `
| 2021.06 - 2024.09 | 西安奥卡云 | 前端小组组长 |
| 2016.07 - 2018.04 | 苏州云联智慧 | 全栈开发 |
| 2024.10 - 至今 | 独立开源 | 独立 |
`;
        const ranges = parseTenureRangesFromText(text);
        expect(ranges.length).toBeGreaterThanOrEqual(3);
        const years = ranges.map((r) => r.startYear).sort();
        expect(years[0]).toBe(2016);
    });
});

describe("extractTenureFromHits + buildTenureAnswer", () => {
    it("uses earliest start from hits", () => {
        const extraction = extractTenureFromHits([
            {
                path: "personal/resume.md",
                title: "resume",
                excerpt:
                    "| 2021.06 - 2024.09 | 奥卡云 |\n| 2016.07 - 2018.04 | 云联 |",
                relevance: 1,
            },
        ]);
        expect(extraction?.earliest.startYear).toBe(2016);
        expect(extraction?.earliest.startMonth).toBe(7);
        const { years } = computeTenureYearsMonths(
            extraction!.earliest,
            new Date("2026-07-16T12:00:00")
        );
        expect(years).toBe(10);
        const { answer, insufficientEvidence } = buildTenureAnswer({
            extraction,
            language: "zh",
            asOfDate: "2026-07-16",
        });
        expect(insufficientEvidence).toBe(false);
        expect(answer).toMatch(/10\s*年/);
        expect(answer).toMatch(/2016/);
    });

    it("reads start year from experience path convention", () => {
        const extraction = extractTenureFromHits([
            {
                path: "corpus/experience/2016-苏州云联智慧.md",
                title: "云联",
                excerpt: "全栈开发",
                relevance: 1,
            },
            {
                path: "corpus/experience/2021-西安奥卡云.md",
                title: "奥卡云",
                excerpt: "前端组长",
                relevance: 0.9,
            },
        ]);
        expect(extraction?.earliest.startYear).toBe(2016);
    });
});
