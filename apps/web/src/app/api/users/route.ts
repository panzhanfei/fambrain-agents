import { getAuthSession } from "@fambrain/auth";
import { prisma } from "@fambrain/db";
import { NextResponse } from "next/server";
const maskNational = (id: string) => {
    if (id.length < 10)
        return "****";
    return `${id.slice(0, 4)}******${id.slice(-4)}`;
};
export const GET = async () => {
    const session = await getAuthSession();
    if (!session) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (!session.canManageMembers) {
        return NextResponse.json({ error: "无权限" }, { status: 403 });
    }
    const rows = await prisma.user.findMany({
        orderBy: [{ createdAt: "desc" }],
        select: {
            id: true,
            username: true,
            displayName: true,
            relationToPrincipal: true,
            nationalId: true,
            role: true,
            status: true,
            createdAt: true,
        },
    });
    const users = rows.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        relationToPrincipal: u.relationToPrincipal,
        nationalIdMasked: maskNational(u.nationalId),
        role: u.role,
        status: u.status,
        createdAt: u.createdAt.toISOString(),
    }));
    /** 前端排序：待审核在前 */
    users.sort((a, b) => {
        const pending = { PENDING: 0, ACTIVE: 1, REJECTED: 2 } as const;
        return pending[a.status] - pending[b.status];
    });
    return NextResponse.json(users);
};
