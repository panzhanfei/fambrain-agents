/** enumeration-target 单元测试：listKind / topics 结构化信号 */
import { describe, expect, it } from "vitest";
import {
    isProjectEnumeration,
    resolveEnumerationTarget,
} from "@/agentflow/agents/online/intake-coordinator";

describe("enumeration-target", () => {
    it("prefers listKind over topics", () => {
        expect(
            resolveEnumerationTarget({
                label: "具体项目名称",
                searchQuery: "项目列表",
                topics: ["experience"],
                listKind: "project",
            })
        ).toBe("project");
    });

    it("routes topics=project to project", () => {
        expect(
            resolveEnumerationTarget({
                label: "列举",
                searchQuery: "列表",
                topics: ["project"],
            })
        ).toBe("project");
    });

    it("routes topics=experience / empty to experience", () => {
        expect(
            resolveEnumerationTarget({
                label: "供职过的公司",
                searchQuery: "公司",
                topics: [],
            })
        ).toBe("experience");
        expect(
            resolveEnumerationTarget({
                label: "任职",
                searchQuery: "工作经历",
                topics: ["experience"],
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
