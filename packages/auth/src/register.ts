import { prisma, UserRole, UserStatus } from "@fambrain/db";
import { AUTH_COOKIE_NAME, authCookieOptions } from "./constants";
import { signAuthToken } from "./jwt";
import { hashPassword } from "./password";
import { registerBodySchema } from "./schemas/auth";
import {
  readRateLimitInts,
  tryConsumeSimpleRateLimit,
} from "./security/rate-limit";
import { cookies } from "next/headers";

export type RegisterServiceResult =
  | { ok: true; redirect: string; bootstrap: boolean }
  | { ok: false; error: string; status: number; retryAfterSec?: number };

/** 注册业务逻辑（Route / Server Action 共用） */
export async function registerUser(
  raw: unknown,
  ipKey: string
): Promise<RegisterServiceResult> {
  const { max: regMax, windowMs: regWindow } = readRateLimitInts(
    process.env.REGISTER_RATE_LIMIT_MAX,
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS,
    { max: 12, windowMs: 60 * 60 * 1000 }
  );

  const rl = tryConsumeSimpleRateLimit(`register:${ipKey}`, regMax, regWindow);
  if (!rl.ok) {
    return {
      ok: false,
      error: "注册次数过多，请稍后再试",
      status: 429,
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const parsed = registerBodySchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("；");
    return { ok: false, error: msg || "字段校验失败", status: 400 };
  }

  const { username, password, nationalId, displayName, relationToPrincipal } =
    parsed.data;
  const normUser = username.toLowerCase();
  const normNat = nationalId;

  const dupId = await prisma.user.findUnique({ where: { nationalId: normNat } });
  if (dupId) {
    return { ok: false, error: "该身份证号已在系统中注册", status: 409 };
  }

  const dup = await prisma.user.findUnique({ where: { username: normUser } });
  if (dup) {
    return { ok: false, error: "该用户名已被注册", status: 409 };
  }

  const total = await prisma.user.count();
  const isBootstrapFirstUser = total === 0;
  const role = isBootstrapFirstUser ? UserRole.ADMIN : UserRole.MEMBER;
  const status = isBootstrapFirstUser ? UserStatus.ACTIVE : UserStatus.PENDING;
  const passwordHash = await hashPassword(password);

  const principal =
    !isBootstrapFirstUser
      ? await prisma.user.findFirst({
          where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        })
      : null;

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
        corpusUserId: principal?.id ?? null,
      },
      select: { id: true },
    });

    const token = await signAuthToken(user.id);
    const store = await cookies();
    store.set(AUTH_COOKIE_NAME, token, authCookieOptions());

    return {
      ok: true,
      bootstrap: isBootstrapFirstUser,
      redirect: isBootstrapFirstUser ? "/" : "/pending",
    };
  } catch (e) {
    const err = e as { code?: string; meta?: { target?: unknown } };
    if (err.code === "P2002") {
      const tgt = err.meta?.target;
      const isNat = Array.isArray(tgt) && tgt.includes("nationalId");
      return {
        ok: false,
        error: isNat ? "该身份证号已在系统中注册" : "该用户名已被占用",
        status: 409,
      };
    }
    if (process.env.NODE_ENV !== "production") console.error(e);
    return { ok: false, error: "注册失败，请稍后重试", status: 500 };
  }
}
