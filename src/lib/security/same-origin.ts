/**
 * Cookie 场景的补充防护：可变请求需 Origin / Referer 与 Host 一致（生产环境）。
 * 与同站 SameSite=Lax、HttpOnly Cookie 一并使用。
 */
import { NextResponse } from "next/server";

function trustedHostRaw(headers: Headers): string | null {
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const xfh = headers.get("x-forwarded-host");
    if (xfh) return xfh.split(",")[0]?.trim().toLowerCase() ?? null;
  }
  return headers.get("host")?.trim().toLowerCase() ?? null;
}

/** `new URL(referer|origin)` 得到的 host **含端口**，与浏览器 Host 头对齐 */
function requestHostComparable(hostRaw: string | null): string | null {
  if (!hostRaw) return null;
  return hostRaw.toLowerCase();
}

function originsHostComparable(urlStr: string): string | null {
  try {
    return new URL(urlStr).host.toLowerCase();
  } catch {
    return null;
  }
}

export function forbiddenIfUntrustedMutation(req: Request): NextResponse | null {
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;

  const headers = req.headers;
  const hostComparable = requestHostComparable(trustedHostRaw(headers));
  const origin = headers.get("origin");
  const referer = headers.get("referer");

  if (process.env.NODE_ENV !== "production") {
    if (!origin && !referer) return null;
  }

  if (!hostComparable) {
    return NextResponse.json({ error: "无效的请求主机" }, { status: 403 });
  }

  if (origin) {
    const oh = originsHostComparable(origin);
    if (!oh || oh !== hostComparable) {
      return NextResponse.json({ error: "拒绝跨域请求" }, { status: 403 });
    }
    return null;
  }

  if (referer) {
    const rh = originsHostComparable(referer);
    if (!rh || rh !== hostComparable) {
      return NextResponse.json({ error: "拒绝跨域请求" }, { status: 403 });
    }
    return null;
  }

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "缺少来源校验信息" }, { status: 403 });
  }

  return null;
}
