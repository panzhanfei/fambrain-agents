import { verifyPassword } from "@/lib/auth/password";
import { signAuthToken } from "@/lib/auth/jwt";
import { AUTH_COOKIE_NAME, authCookieOptions } from "@/lib/auth/constants";
import { prisma } from "@/lib/prisma";
import { loginBodySchema } from "@/lib/schemas/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRequestIpKey } from "@/lib/security/client-ip";
import {
  readRateLimitInts,
  tryConsumeSimpleRateLimit,
} from "@/lib/security/rate-limit";
import { rejectIfPayloadTooLarge } from "@/lib/security/request-limits";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { jitterAuthFailure } from "@/lib/security/timing";

export const runtime = "nodejs";

const MAX_JSON_BODY = 32_768;

/** 不向客户端区分账号状态，避免枚举已注册用户名 */
function loginUnauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: "登录失败，请核对用户名和密码" },
    { status: 401 },
  );
}

export async function POST(req: Request) {
  const untrusted = forbiddenIfUntrustedMutation(req);
  if (untrusted) return untrusted;

  const oversized = rejectIfPayloadTooLarge(req, MAX_JSON_BODY);
  if (oversized) return oversized;

  const { max: loginMax, windowMs: loginWindow } = readRateLimitInts(
    process.env.LOGIN_RATE_LIMIT_MAX,
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
    { max: 40, windowMs: 15 * 60 * 1000 },
  );

  const ipKey = getRequestIpKey(req.headers);
  const rl = tryConsumeSimpleRateLimit(`login:${ipKey}`, loginMax, loginWindow);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "登录尝试过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "用户名或密码无效" }, { status: 400 });
  }

  const parsed = loginBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "用户名或密码无效" }, { status: 400 });
  }

  const { username, password } = parsed.data;
  const normUser = username.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { username: normUser },
  });

  if (!user) {
    await jitterAuthFailure();
    return loginUnauthorizedResponse();
  }

  if (user.status === "REJECTED") {
    await jitterAuthFailure();
    return loginUnauthorizedResponse();
  }

  const okPw = await verifyPassword(password, user.passwordHash);
  if (!okPw) {
    await jitterAuthFailure();
    return loginUnauthorizedResponse();
  }

  const token = await signAuthToken(user.id);
  const store = await cookies();
  store.set(AUTH_COOKIE_NAME, token, authCookieOptions());

  const redirect = user.status === "PENDING" ? "/pending" : "/";

  return NextResponse.json({
    ok: true,
    redirect,
    status: user.status,
    role: user.role,
  });
}
