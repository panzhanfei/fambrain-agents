import { SignJWT, jwtVerify } from "jose";

import { TOKEN_MAX_AGE_SEC } from "./constants";

export type VerifiedJwt = {
  sub: string;
  exp?: number;
  iat?: number;
};

function jwtEpochSeconds(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  return undefined;
}

export function getJwtSecretKey(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 24) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET 长度至少 24（生产环境必需）");
    }
    console.warn("[fambrain] 使用占位 JWT_SECRET，仅限本地开发");
    return new TextEncoder().encode("fambrain-dev-only-secret-change-me!!");
  }
  return new TextEncoder().encode(s);
}

/** 令牌只携带合法用户 id（具体权限每次从数据库读取）。 */
export async function signAuthToken(userId: string): Promise<string> {
  const sk = getJwtSecretKey();
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_MAX_AGE_SEC}s`)
    .sign(sk);
}

/** 校验签名与 exp，容忍少量时钟漂移（秒） */
export async function verifyJwt(raw: string): Promise<VerifiedJwt> {
  const sk = getJwtSecretKey();
  const { payload } = await jwtVerify(raw, sk, {
    algorithms: ["HS256"],
    clockTolerance: 90,
  });
  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new Error("invalid token subject");
  }

  return {
    sub,
    exp: jwtEpochSeconds(payload.exp),
    iat: jwtEpochSeconds(payload.iat),
  };
}

export async function verifyAuthToken(raw: string): Promise<string> {
  const { sub } = await verifyJwt(raw);
  return sub;
}
