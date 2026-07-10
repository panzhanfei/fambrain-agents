import { describe, expect, it } from "vitest";
import {
    buildAgeAnswer,
    computeAgeYears,
    extractBirthOrAgeFromText,
    isAgeSubQuestion,
} from "./compute-age";

describe("compute-age", () => {
    it("extracts birth date from resume table", () => {
        const r = extractBirthOrAgeFromText("| 出生日期 | 1993.03 |");
        expect(r.birth?.year).toBe(1993);
        expect(r.birth?.month).toBe(3);
    });

    it("computes 周岁 from birth date", () => {
        const age = computeAgeYears(
            { year: 1993, month: 3 },
            new Date("2026-07-09T12:00:00")
        );
        expect(age).toBe(33);
    });

    it("detects age sub-questions", () => {
        expect(isAgeSubQuestion("我今年多大")).toBe(true);
        expect(isAgeSubQuestion("姓名叫什么")).toBe(false);
    });

    it("builds insufficient answer when no birth field", () => {
        const { answer, insufficientEvidence } = buildAgeAnswer({
            extraction: {},
            language: "zh",
            asOfDate: "2026-07-09",
        });
        expect(insufficientEvidence).toBe(true);
        expect(answer).toMatch(/未标注当前年龄/);
    });
});
