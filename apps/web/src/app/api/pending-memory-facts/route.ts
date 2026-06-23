import { getAuthSession } from "@fambrain/auth";
import { listPendingMemoryFactsForUser } from "@fambrain/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export const GET = async () => {
    const session = await getAuthSession();
    if (!session) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (session.status !== "ACTIVE") {
        return NextResponse.json({ error: "账号未激活" }, { status: 403 });
    }
    const rows = await listPendingMemoryFactsForUser(session.userId);
    return NextResponse.json({ items: rows });
};
