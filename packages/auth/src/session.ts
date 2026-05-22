import { cookies } from "next/headers";

import { prisma, type UserRole, type UserStatus } from "@fambrain/db";

import { AUTH_COOKIE_NAME, nationalIdHasMembershipAuditPrivilege } from "./constants";
import { verifyAuthToken } from "./jwt";

export type AuthSession = {
  userId: string;
  username: string;
  displayName: string;
  relationToPrincipal: string;
  nationalIdLast4: string;
  /** 身份证号匹配配置后缀时可审核 / 删除成员 */
  canManageMembers: boolean;
  role: UserRole;
  status: UserStatus;
};

function maskNationalId(id: string): string {
  if (id.length < 6) return "****";
  return `${id.slice(0, 4)}******${id.slice(-4)}`;
}

export async function getAuthToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(AUTH_COOKIE_NAME)?.value ?? null;
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const raw = await getAuthToken();
  if (!raw) return null;

  let userId: string;
  try {
    userId = await verifyAuthToken(raw);
  } catch {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      relationToPrincipal: true,
      nationalId: true,
      role: true,
      status: true,
    },
  });

  if (!user) return null;

  const canManageMembers = nationalIdHasMembershipAuditPrivilege(user.nationalId);

  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    relationToPrincipal: user.relationToPrincipal,
    nationalIdLast4: maskNationalId(user.nationalId),
    canManageMembers,
    role: user.role,
    status: user.status,
  };
}
