import { AUTH_COOKIE_NAME, authCookieOptions } from "@/lib/auth/constants";
import { signAuthToken } from "@/lib/auth/jwt";
import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
import { loginBodySchema } from "@/lib/schemas/auth";
import {
  readRateLimitInts,
  tryConsumeSimpleRateLimit,
} from "@/lib/security/rate-limit";
import { jitterAuthFailure } from "@/lib/security/timing";
import { cookies } from "next/headers";

export type LoginServiceResult =
  | { ok: true; redirect: string }
  | { ok: false; error: string; status: number; retryAfterSec?: number };

/** 登录业务逻辑（Route / Server Action 共用） */
export async function loginUser(
  raw: unknown,
  ipKey: string
): Promise<LoginServiceResult> {
  const { max: loginMax, windowMs: loginWindow } = readRateLimitInts(
    process.env.LOGIN_RATE_LIMIT_MAX,
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
    { max: 40, windowMs: 15 * 60 * 1000 }
  );

  const rl = tryConsumeSimpleRateLimit(`login:${ipKey}`, loginMax, loginWindow);
  if (!rl.ok) {
    return {
      ok: false,
      error: "登录尝试过于频繁，请稍后再试",
      status: 429,
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const parsed = loginBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "用户名或密码无效", status: 400 };
  }

  const { username, password } = parsed.data;
  const normUser = username.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { username: normUser },
  });

  if (!user || user.status === "REJECTED") {
    await jitterAuthFailure();
    return {
      ok: false,
      error: "登录失败，请核对用户名和密码",
      status: 401,
    };
  }

  const okPw = await verifyPassword(password, user.passwordHash);
  if (!okPw) {
    await jitterAuthFailure();
    return {
      ok: false,
      error: "登录失败，请核对用户名和密码",
      status: 401,
    };
  }

  const token = await signAuthToken(user.id);
  const store = await cookies();
  store.set(AUTH_COOKIE_NAME, token, authCookieOptions());

  const redirect = user.status === "PENDING" ? "/pending" : "/";
  return { ok: true, redirect };
}
