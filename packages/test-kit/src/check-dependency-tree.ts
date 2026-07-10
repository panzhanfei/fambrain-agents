import fs from "node:fs";
import path from "node:path";

export type DepTreeIssueKind =
    | "missing_export"
    | "missing_script"
    | "missing_workspace_dep"
    | "broken_import";

export type DepTreeIssue = {
    kind: DepTreeIssueKind;
    packageName: string;
    detail: string;
    file?: string;
};

export type DepTreeReport = {
    rootDir: string;
    packages: string[];
    issues: DepTreeIssue[];
    checkedExports: number;
    checkedScripts: number;
    checkedImports: number;
};

export type CheckDependencyTreeOptions = {
    rootDir: string;
    /** 仅检查这些 workspace 包名 */
    packageFilter?: string[];
    /** 扫描 package exports / scripts 引用的 .ts 文件内相对/import 路径 */
    scanImportPaths?: boolean;
};

const WORKSPACE_GLOB = /^(apps|packages)\/\*$/;

const TS_EXT = /\.(ts|tsx|mts|mjs|js)$/;

const SCRIPT_ENTRY_RE =
    /(?:^|\s)(?:tsx|node)(?:\s+watch)?(?:\s+--env-file=[^\s]+)?\s+([^\s]+\.(?:ts|tsx|mjs|js))/g;

const BASH_SCRIPT_RE = /bash\s+([^\s]+\.sh)/g;

const IMPORT_RE =
    /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g;

const readJson = <T>(filePath: string): T =>
    JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const fileExists = (filePath: string): boolean => {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
};

const resolveExportTarget = (pkgDir: string, target: string): string => {
    const clean = target.replace(/^\.\//, "");
    return path.join(pkgDir, clean);
};

const collectExportPaths = (
    exportsField: unknown
): Array<{ subpath: string; target: string }> => {
    if (!exportsField) return [];
    if (typeof exportsField === "string") {
        return [{ subpath: ".", target: exportsField }];
    }
    if (typeof exportsField !== "object" || exportsField === null) return [];
    const out: Array<{ subpath: string; target: string }> = [];
    for (const [subpath, value] of Object.entries(exportsField)) {
        if (typeof value === "string") {
            out.push({ subpath, target: value });
            continue;
        }
        if (value && typeof value === "object") {
            const rec = value as Record<string, string>;
            const target =
                rec.import ?? rec.default ?? rec.require ?? rec.node;
            if (typeof target === "string") {
                out.push({ subpath, target });
            }
        }
    }
    return out;
};

const discoverWorkspacePackageDirs = (rootDir: string): string[] => {
    const workspaceFile = path.join(rootDir, "pnpm-workspace.yaml");
    if (!fileExists(workspaceFile)) {
        return [];
    }
    const text = fs.readFileSync(workspaceFile, "utf8");
    const patterns = [...text.matchAll(/-\s*["']?([^"'\n]+)["']?/g)]
        .map((m) => m[1]!.trim())
        .filter((p) => WORKSPACE_GLOB.test(p) || p.includes("*"));

    const dirs: string[] = [];
    for (const pattern of patterns) {
        const base = pattern.replace(/\/\*$/, "");
        const absBase = path.join(rootDir, base);
        if (!fs.existsSync(absBase)) continue;
        for (const name of fs.readdirSync(absBase)) {
            const pkgDir = path.join(absBase, name);
            if (fileExists(path.join(pkgDir, "package.json"))) {
                dirs.push(pkgDir);
            }
        }
    }
    return dirs.sort();
};

const extractScriptEntries = (command: string): string[] => {
    const entries: string[] = [];
    for (const re of [SCRIPT_ENTRY_RE, BASH_SCRIPT_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(command)) !== null) {
            entries.push(m[1]!);
        }
    }
    return entries;
};

const resolveImportSpecifier = (
    fromFile: string,
    specifier: string
): string | null => {
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
        return null;
    }
    const dir = path.dirname(fromFile);
    let base: string;
    if (specifier.startsWith("@/")) {
        const brainSrc = path.join(
            path.dirname(path.dirname(path.dirname(fromFile))),
            "apps/brain-service/src"
        );
        base = path.join(brainSrc, specifier.slice(2));
    } else {
        base = path.resolve(dir, specifier);
    }
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
    ];
    return candidates.find((c) => fileExists(c)) ?? base;
};

const scanFileImports = (
    pkgDir: string,
    filePath: string,
    issues: DepTreeIssue[],
    packageName: string,
    checkedImports: { count: number }
): void => {
    if (!fileExists(filePath) || !TS_EXT.test(filePath)) return;
    const text = fs.readFileSync(filePath, "utf8");
    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(text)) !== null) {
        const spec = m[1]!;
        if (spec.startsWith("@fambrain/")) continue;
        const resolved = resolveImportSpecifier(filePath, spec);
        if (!resolved) continue;
        checkedImports.count += 1;
        if (!fileExists(resolved) && !fileExists(`${resolved}.ts`)) {
            issues.push({
                kind: "broken_import",
                packageName,
                detail: `import "${spec}" 无法解析`,
                file: path.relative(pkgDir, filePath),
            });
        }
    }
};

export const checkDependencyTree = (
    options: CheckDependencyTreeOptions
): DepTreeReport => {
    const rootDir = path.resolve(options.rootDir);
    const pkgDirs = discoverWorkspacePackageDirs(rootDir);
    const nameToDir = new Map<string, string>();

    for (const pkgDir of pkgDirs) {
        const pkg = readJson<{ name?: string }>(
            path.join(pkgDir, "package.json")
        );
        if (pkg.name) nameToDir.set(pkg.name, pkgDir);
    }

    const issues: DepTreeIssue[] = [];
    let checkedExports = 0;
    let checkedScripts = 0;
    const checkedImports = { count: 0 };
    const packages: string[] = [];

    for (const pkgDir of pkgDirs) {
        const pkgJsonPath = path.join(pkgDir, "package.json");
        const pkg = readJson<{
            name?: string;
            exports?: unknown;
            scripts?: Record<string, string>;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        }>(pkgJsonPath);

        const packageName = pkg.name ?? path.basename(pkgDir);
        if (
            options.packageFilter?.length &&
            !options.packageFilter.includes(packageName)
        ) {
            continue;
        }
        packages.push(packageName);

        for (const { subpath, target } of collectExportPaths(pkg.exports)) {
            checkedExports += 1;
            const abs = resolveExportTarget(pkgDir, target);
            if (!fileExists(abs)) {
                issues.push({
                    kind: "missing_export",
                    packageName,
                    detail: `exports["${subpath}"] → ${target} 不存在`,
                    file: target,
                });
            }
        }

        for (const [scriptName, command] of Object.entries(pkg.scripts ?? {})) {
            for (const entry of extractScriptEntries(command)) {
                checkedScripts += 1;
                const abs = path.isAbsolute(entry)
                    ? entry
                    : path.join(pkgDir, entry);
                if (!fileExists(abs)) {
                    issues.push({
                        kind: "missing_script",
                        packageName,
                        detail: `scripts.${scriptName} 入口不存在: ${entry}`,
                        file: entry,
                    });
                } else if (options.scanImportPaths && TS_EXT.test(abs)) {
                    scanFileImports(
                        pkgDir,
                        abs,
                        issues,
                        packageName,
                        checkedImports
                    );
                }
            }
        }

        const allDeps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
        };
        for (const [depName, range] of Object.entries(allDeps ?? {})) {
            if (
                typeof range === "string" &&
                range.startsWith("workspace:") &&
                !nameToDir.has(depName)
            ) {
                issues.push({
                    kind: "missing_workspace_dep",
                    packageName,
                    detail: `workspace 依赖 ${depName} 未在 monorepo 中找到`,
                });
            }
        }
    }

    return {
        rootDir,
        packages,
        issues,
        checkedExports,
        checkedScripts,
        checkedImports: checkedImports.count,
    };
};

export const formatDepTreeReport = (report: DepTreeReport): string => {
    const lines: string[] = [
        `依赖树校验 · ${report.rootDir}`,
        `包: ${report.packages.length} · exports: ${report.checkedExports} · scripts: ${report.checkedScripts} · imports: ${report.checkedImports}`,
    ];
    if (report.issues.length === 0) {
        lines.push("OK — 未发现断链");
        return lines.join("\n");
    }
    lines.push(`问题: ${report.issues.length}`);
    for (const issue of report.issues) {
        const loc = issue.file ? ` (${issue.file})` : "";
        lines.push(`  [${issue.kind}] ${issue.packageName}${loc}: ${issue.detail}`);
    }
    return lines.join("\n");
};
