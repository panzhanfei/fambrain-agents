import type { NextConfig } from "next";

function securityHeaders(): { key: string; value: string }[] {
  const base = [
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    /** 家庭内网可自行放宽；按需可在反向代理上加 CSP */
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];

  if (process.env.SECURITY_ENABLE_HSTS === "true") {
    base.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return base;
}

const nextConfig: NextConfig = {
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
