import { describe, expect, it } from "vitest";
import {
    resolveIdentityField,
    userQuestionSuggestsHybridDag,
    labelSuggestsWebSource,
} from "./field-catalog";

describe("field-catalog", () => {
    it("maps age labels to compute tool", () => {
        const field = resolveIdentityField("我今年多大");
        expect(field?.id).toBe("age");
        expect(field?.toolId).toBe("compute_age_from_hits");
    });

    it("detects web-oriented queries", () => {
        expect(labelSuggestsWebSource("公司最近怎么样", "奥卡云")).toBe(true);
        expect(labelSuggestsWebSource("姓名", "潘展飞")).toBe(false);
    });

    it("detects hybrid evaluation questions", () => {
        const q = "根据我的简历和今年市场行情，评估我去奥卡云公司的机会";
        expect(userQuestionSuggestsHybridDag(q)).toBe(true);
        expect(userQuestionSuggestsHybridDag("列出全部项目")).toBe(false);
    });
});
