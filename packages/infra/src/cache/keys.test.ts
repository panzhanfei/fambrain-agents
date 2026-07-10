import { describe, expect, it } from "vitest";
import { normalizeSearchQuery } from "./keys";

describe("normalizeSearchQuery", () => {
    it("trims, lowercases and strips trailing punctuation", () => {
        expect(normalizeSearchQuery("  React  18？ ")).toBe("react 18");
    });

    it("collapses internal whitespace", () => {
        expect(normalizeSearchQuery("城管   平台")).toBe("城管 平台");
    });
});
