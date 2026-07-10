import { describe, expect, it } from "vitest";
import { buildBm25Index } from "./bm25";

describe("bm25", () => {
    it("ranks doc with matching terms higher", () => {
        const index = buildBm25Index([
            ["react", "typescript", "前端"],
            ["java", "spring", "后端"],
        ]);
        const scores = index.score(["react", "前端"]);
        expect(scores[0]).toBeGreaterThan(scores[1]!);
    });

    it("returns empty scores for empty corpus", () => {
        const index = buildBm25Index([]);
        expect(index.score(["react"])).toEqual([]);
    });
});
