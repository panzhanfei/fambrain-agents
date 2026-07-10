import { describe, expect, it } from "vitest";
import {
    isProjectEnumeration,
    resolveEnumerationTarget,
} from "./enumeration-target";

describe("enumeration-target", () => {
    it("prefers project when label mentions 项目", () => {
        expect(
            resolveEnumerationTarget({
                label: "具体项目名称",
                searchQuery: "项目列表",
                topics: ["experience"],
            })
        ).toBe("project");
    });

    it("routes company enumeration to experience", () => {
        expect(
            resolveEnumerationTarget({
                label: "供职过的公司",
                searchQuery: "公司",
                topics: [],
            })
        ).toBe("experience");
    });

    it("isProjectEnumeration helper", () => {
        expect(
            isProjectEnumeration({
                label: "做过哪些项目",
                searchQuery: "项目",
                topics: ["project"],
            })
        ).toBe(true);
    });
});
