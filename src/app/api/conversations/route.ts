import { getAuthSession } from "@/lib/auth/session";
import { getSidebarConversations } from "@/lib/get-sidebar-conversations";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** 侧边栏对话列表（含最新一条消息摘要） */
export async function GET() {
  try {
    const session = await getAuthSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (session.status !== "ACTIVE") {
      return NextResponse.json({ error: "账号待审核或未通过审核" }, { status: 403 });
    }

    const body = await getSidebarConversations(session.userId);
    return NextResponse.json(body);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "加载对话列表失败" }, { status: 500 });
  }
}
