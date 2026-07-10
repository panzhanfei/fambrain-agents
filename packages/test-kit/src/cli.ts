#!/usr/bin/env node
/**
 * 全仓库依赖树校验 CLI。
 *
 *   pnpm check:deps
 *   pnpm fambrain-check-deps --json
 *   pnpm fambrain-check-deps --package @fambrain/brain-service --scan-imports
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    checkDependencyTree,
    formatDepTreeReport,
} from "./check-dependency-tree";

const argv = process.argv.slice(2);

const hasFlag = (name: string): boolean => argv.includes(name);

const flagValue = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    if (idx === -1 || idx + 1 >= argv.length) return undefined;
    return argv[idx + 1];
};

const rootFromCli = (): string => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, "../../../");
};

const packageFilter = (): string[] | undefined => {
    const raw = flagValue("--package") ?? flagValue("-p");
    if (!raw) return undefined;
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
};

const main = (): void => {
    const report = checkDependencyTree({
        rootDir: flagValue("--root") ?? rootFromCli(),
        packageFilter: packageFilter(),
        scanImportPaths: hasFlag("--scan-imports"),
    });

    if (hasFlag("--json")) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log(formatDepTreeReport(report));
    }

    if (report.issues.length > 0) {
        process.exitCode = 1;
    }
};

main();
