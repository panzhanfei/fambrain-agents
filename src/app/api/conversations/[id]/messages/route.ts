import { getAuthSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { conversationIdSchema } from "@/lib/schemas/chat";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type UiRole = "user" | "assistant";

function mapRole(role: string): UiRole {
  return role === "user" ? "user" : "assistant";
}

/** 会话内消息（按时间正序），供中间区域展示 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (session.status !== "ACTIVE") {
    return NextResponse.json({ error: "账号待审核或未通过审核" }, { status: 403 });
  }

  const rawId = (await context.params).id;
  const parsedId = conversationIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "无效会话 id" }, { status: 400 });
  }

  try {
    const exists = await prisma.conversation.findUnique({
      where: { id: parsedId.data },
      select: { id: true, userId: true },
    });
    if (!exists || exists.userId !== session.userId) {
      return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    }

    const rows = await prisma.message.findMany({
      where: { conversationId: parsedId.data },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        content: true,
      },
    });

    const messages = rows.map((m) => ({
      id: m.id,
      role: mapRole(m.role),
      content: m.content,
    }));

    return NextResponse.json(messages);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "加载消息失败" }, { status: 500 });
  }
}
