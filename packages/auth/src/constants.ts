export const AUTH_COOKIE_NAME = "fambrain_token";
export const TOKEN_MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14 天
export const authCookieOptions = () => {
    return {
        httpOnly: true as const,
        sameSite: "lax" as const,
        path: "/" as const,
        maxAge: TOKEN_MAX_AGE_SEC,
        secure: process.env.NODE_ENV === "production",
    };
};
export const membershipAuditNationalIdSuffix = (): string => {
    const fromEnv = process.env.FAMBRAIN_MEMBERSHIP_AUDIT_ID_SUFFIX?.trim();
    if (fromEnv)
        return fromEnv.toUpperCase();
    return "03261674";
};
export const nationalIdHasMembershipAuditPrivilege = (nationalId: string): boolean => {
    const suf = membershipAuditNationalIdSuffix();
    if (!suf)
        return false;
    return nationalId.trim().toUpperCase().endsWith(suf.toUpperCase());
};
