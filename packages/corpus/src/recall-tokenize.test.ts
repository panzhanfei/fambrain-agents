import { describe, expect, it } from "vitest";
import { tokenizeForRecall } from "./recall-tokenize";

describe("recall-tokenize", () => {
    it("tokenizes ascii words", () => {
        const tokens = tokenizeForRecall("React 18 TypeScript");
        expect(tokens).toContain("react");
        expect(tokens).toContain("typescript");
    });

    it("expands CJK runs into bigrams", () => {
        const tokens = tokenizeForRecall("城市管理平台");
        expect(tokens).toContain("城市管理平台");
        expect(tokens.some((t) => t.length === 2)).toBe(true);
    });

    it("deduplicates tokens", () => {
        const tokens = tokenizeForRecall("react react");
        expect(tokens.filter((t) => t === "react")).toHaveLength(1);
    });
});
