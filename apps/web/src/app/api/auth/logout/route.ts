import { AUTH_COOKIE_NAME } from "@fambrain/auth";
import { getRequestIpKey } from "@/lib/security/client-ip";
import { readRateLimitInts, tryConsumeSimpleRateLimit, } from "@/lib/security/rate-limit";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
export const POST = async (req: Request) => {
    const untrusted = forbiddenIfUntrustedMutation(req);
    if (untrusted)
        return untrusted;
    const { max, windowMs } = readRateLimitInts(process.env.LOGOUT_RATE_LIMIT_MAX, process.env.LOGOUT_RATE_LIMIT_WINDOW_MS, { max: 180, windowMs: 60000 });
    const ipKey = getRequestIpKey(req.headers);
    const rl = tryConsumeSimpleRateLimit(`logout:${ipKey}`, max, windowMs);
    if (!rl.ok) {
        return NextResponse.json({ error: "操作过于频繁" }, {
            status: 429,
            headers: { "Retry-After": String(rl.retryAfterSec) },
        });
    }
    const store = await cookies();
    store.set(AUTH_COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return NextResponse.json({ ok: true });
};
