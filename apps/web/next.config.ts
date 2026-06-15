import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";
loadEnv({ path: path.join(__dirname, "../../.env") });
const securityHeaders = (): {
    key: string;
    value: string;
}[] => {
    const base = [
        { key: "X-DNS-Prefetch-Control", value: "off" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];
    if (process.env.SECURITY_ENABLE_HSTS === "true") {
        base.push({
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
        });
    }
    return base;
};
const nextConfig: NextConfig = {
    output: "standalone",
    turbopack: {
        root: path.join(__dirname, "../.."),
    },
    transpilePackages: [
        "@fambrain/agent-types",
        "@fambrain/agent-config",
        "@fambrain/agent-shared",
        "@fambrain/db",
        "@fambrain/auth",
    ],
    serverExternalPackages: ["@prisma/client", "better-sqlite3"],
    poweredByHeader: false,
    headers: async () => [
        {
            source: "/:path*",
            headers: securityHeaders(),
        },
    ],
};
export default nextConfig;
