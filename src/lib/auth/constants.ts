export const AUTH_COOKIE_NAME = "fambrain_token";
export const TOKEN_MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14 天

/** httpOnly JWT Cookie（middleware / Route Handler 共用，勿依赖 prisma） */
export function authCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: TOKEN_MAX_AGE_SEC,
    secure: process.env.NODE_ENV === "production",
  };
}

/**
 * 身份证号以该 **后缀** 结尾（末位可为 X）的账号才拥有「审核成员 / 删除成员」权限。
 * 可用环境变量覆盖：FAMBRAIN_MEMBERSHIP_AUDIT_ID_SUFFIX
 */
export function membershipAuditNationalIdSuffix(): string {
  const fromEnv = process.env.FAMBRAIN_MEMBERSHIP_AUDIT_ID_SUFFIX?.trim();
  if (fromEnv) return fromEnv.toUpperCase();
  return "03261674";
}

export function nationalIdHasMembershipAuditPrivilege(nationalId: string): boolean {
  const suf = membershipAuditNationalIdSuffix();
  if (!suf) return false;
  return nationalId.trim().toUpperCase().endsWith(suf.toUpperCase());
}
