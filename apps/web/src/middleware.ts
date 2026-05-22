import { AUTH_COOKIE_NAME, authCookieOptions } from "@fambrain/auth/constants";
import { signAuthToken, verifyJwt, type VerifiedJwt } from "@fambrain/auth/jwt";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function renewThresholdSeconds(): number {
  /** 距过期还剩不足该秒数时续签。≤0：每次校验通过都重新签发（耗电，适合极低流量场景） */
  const parsed = Number.parseInt(process.env.JWT_RENEW_BEFORE_EXPIRY_SEC ?? `${4 * 24 * 3600}`, 10);
  return Number.isFinite(parsed) ? parsed : 4 * 24 * 3600;
}

async function attachSilentRenewCookie(res: NextResponse, jwt: VerifiedJwt): Promise<NextResponse> {
  const nowSec = Math.floor(Date.now() / 1000);
  const threshold = renewThresholdSeconds();
  const remaining = jwt.exp !== undefined ? jwt.exp - nowSec : 0;
  const shouldRenew =
    threshold <= 0 || jwt.exp === undefined || remaining <= threshold;
  if (!shouldRenew) return res;

  const token = await signAuthToken(jwt.sub);
  res.cookies.set(AUTH_COOKIE_NAME, token, authCookieOptions());
  return res;
}

async function readJwtCookie(rawCookie: string | undefined): Promise<VerifiedJwt> {
  if (!rawCookie) throw new Error("no cookie");
  return verifyJwt(rawCookie);
}

export async function middleware(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return NextResponse.next();
  }

  const pathname = req.nextUrl.pathname;

  if (pathname.startsWith("/api/")) {
    const originBlock = forbiddenIfUntrustedMutation(req);
    if (originBlock) return originBlock;
  }

  try {
    const jwt = await readJwtCookie(req.cookies.get(AUTH_COOKIE_NAME)?.value);
    const res = NextResponse.next();
    return await attachSilentRenewCookie(res, jwt);
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "未登录或登录已失效" }, { status: 401 });
    }
    const target = `/login${pathname ? `?from=${encodeURIComponent(pathname)}` : ""}`;
    return NextResponse.redirect(new URL(target, req.url));
  }
}

export const config = {
  matcher: [
    "/",
    "/me/:path*",
    "/admin/:path*",
    "/pending/:path*",
    "/pending",
    "/api/conversations/:path*",
    "/api/users/:path*",
    "/api/auth/me",
  ],
};
