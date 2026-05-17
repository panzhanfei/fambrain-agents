import { UserRole, UserStatus } from "@/generated/prisma/client";
import { AUTH_COOKIE_NAME, authCookieOptions } from "@/lib/auth/constants";
import { hashPassword } from "@/lib/auth/password";
import { signAuthToken } from "@/lib/auth/jwt";
import { prisma } from "@/lib/prisma";
import { registerBodySchema } from "@/lib/schemas/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRequestIpKey } from "@/lib/security/client-ip";
import {
  readRateLimitInts,
  tryConsumeSimpleRateLimit,
} from "@/lib/security/rate-limit";
import { rejectIfPayloadTooLarge } from "@/lib/security/request-limits";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";

export const runtime = "nodejs";

const MAX_JSON_BODY = 65_536;

export async function POST(req: Request) {
  const untrusted = forbiddenIfUntrustedMutation(req);
  if (untrusted) return untrusted;

  const oversized = rejectIfPayloadTooLarge(req, MAX_JSON_BODY);
  if (oversized) return oversized;

  const { max: regMax, windowMs: regWindow } = readRateLimitInts(
    process.env.REGISTER_RATE_LIMIT_MAX,
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS,
    { max: 12, windowMs: 60 * 60 * 1000 },
  );

  const ipKey = getRequestIpKey(req.headers);
  const rl = tryConsumeSimpleRateLimit(`register:${ipKey}`, regMax, regWindow);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "注册次数过多，请稍后再试" },
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
    return NextResponse.json({ error: "请求体必须为 JSON" }, { status: 400 });
  }

  const parsed = registerBodySchema.safeParse(json);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("；");
    return NextResponse.json({ error: msg || "字段校验失败" }, { status: 400 });
  }

  const { username, password, nationalId, displayName, relationToPrincipal } = parsed.data;
  const normUser = username.toLowerCase();
  const normNat = nationalId;

  const dupId = await prisma.user.findUnique({ where: { nationalId: normNat } });
  if (dupId) {
    return NextResponse.json({ error: "该身份证号已在系统中注册" }, { status: 409 });
  }

  const dup = await prisma.user.findUnique({ where: { username: normUser } });
  if (dup) {
    return NextResponse.json({ error: "该用户名已被注册" }, { status: 409 });
  }

  const total = await prisma.user.count();

  /** 系统中还没有任何账号时（冷启动）：首个注册者自动成为已审核管理员，无需他人同意 */
  const isBootstrapFirstUser = total === 0;
  const role = isBootstrapFirstUser ? UserRole.ADMIN : UserRole.MEMBER;
  const status = isBootstrapFirstUser ? UserStatus.ACTIVE : UserStatus.PENDING;

  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        username: normUser,
        passwordHash,
        nationalId: normNat,
        displayName,
        relationToPrincipal,
        role,
        status,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        relationToPrincipal: true,
        role: true,
        status: true,
      },
    });

    const token = await signAuthToken(user.id);
    const store = await cookies();
    store.set(AUTH_COOKIE_NAME, token, authCookieOptions());

    return NextResponse.json({
      ok: true,
      user,
      bootstrap: isBootstrapFirstUser,
      redirect: isBootstrapFirstUser ? "/" : "/pending",
    });
  } catch (e) {
    const err = e as { code?: string; meta?: { target?: unknown } };
    if (err.code === "P2002") {
      const tgt = err.meta?.target;
      const isNat = Array.isArray(tgt) && tgt.includes("nationalId");
      return NextResponse.json(
        {
          error: isNat ? "该身份证号已在系统中注册" : "该用户名已被占用",
        },
        { status: 409 },
      );
    }
    if (process.env.NODE_ENV !== "production") console.error(e);
    return NextResponse.json({ error: "注册失败，请稍后重试" }, { status: 500 });
  }
}
