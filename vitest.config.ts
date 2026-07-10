import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    test: {
        globals: false,
        environment: "node",
        include: [
            "apps/brain-service/src/**/*.test.ts",
            "packages/*/src/**/*.test.ts",
            "packages/test-kit/src/**/*.test.ts",
        ],
        exclude: ["**/node_modules/**", "**/dist/**", "apps/web/**"],
        passWithNoTests: false,
    },
    resolve: {
        alias: {
            "@": path.resolve(root, "apps/brain-service/src"),
        },
    },
});
