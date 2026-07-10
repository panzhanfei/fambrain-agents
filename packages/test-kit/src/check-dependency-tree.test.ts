import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDependencyTree } from "./check-dependency-tree";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fambrain-deps-"));
    tmpDirs.push(dir);
    return dir;
};

afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

const write = (filePath: string, content: string): void => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
};

describe("checkDependencyTree", () => {
    it("flags missing export and script entry", () => {
        const root = mkTmp();
        write(
            path.join(root, "pnpm-workspace.yaml"),
            'packages:\n  - "packages/*"\n'
        );
        const pkgDir = path.join(root, "packages", "demo");
        write(
            path.join(pkgDir, "package.json"),
            JSON.stringify(
                {
                    name: "@demo/pkg",
                    exports: { ".": "./src/missing.ts" },
                    scripts: { dev: "tsx src/also-missing.ts" },
                },
                null,
                2
            )
        );
        write(path.join(pkgDir, "src", "ok.ts"), "export const ok = 1;\n");

        const report = checkDependencyTree({ rootDir: root });
        expect(report.issues).toHaveLength(2);
        expect(report.issues.map((i) => i.kind).sort()).toEqual([
            "missing_export",
            "missing_script",
        ]);
    });

    it("passes when exports and scripts resolve", () => {
        const root = mkTmp();
        write(
            path.join(root, "pnpm-workspace.yaml"),
            'packages:\n  - "packages/*"\n'
        );
        const pkgDir = path.join(root, "packages", "good");
        write(path.join(pkgDir, "src", "index.ts"), "export {};\n");
        write(
            path.join(pkgDir, "package.json"),
            JSON.stringify(
                {
                    name: "@good/pkg",
                    exports: { ".": "./src/index.ts" },
                    scripts: { test: "tsx src/index.ts" },
                },
                null,
                2
            )
        );

        const report = checkDependencyTree({ rootDir: root });
        expect(report.issues).toHaveLength(0);
        expect(report.checkedExports).toBe(1);
        expect(report.checkedScripts).toBe(1);
    });

    it("flags unresolved workspace dependency", () => {
        const root = mkTmp();
        write(
            path.join(root, "pnpm-workspace.yaml"),
            'packages:\n  - "packages/*"\n'
        );
        const pkgDir = path.join(root, "packages", "lonely");
        write(path.join(pkgDir, "src", "index.ts"), "export {};\n");
        write(
            path.join(pkgDir, "package.json"),
            JSON.stringify(
                {
                    name: "@lonely/pkg",
                    exports: { ".": "./src/index.ts" },
                    dependencies: {
                        "@missing/workspace": "workspace:*",
                    },
                },
                null,
                2
            )
        );

        const report = checkDependencyTree({ rootDir: root });
        expect(report.issues.some((i) => i.kind === "missing_workspace_dep")).toBe(
            true
        );
    });
});
