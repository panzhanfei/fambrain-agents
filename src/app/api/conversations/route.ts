import { getAuthSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getSidebarConversations } from "@/lib/get-sidebar-conversations";
import { createConversationSchema } from "@/lib/schemas/chat";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { rejectIfPayloadTooLarge } from "@/lib/security/request-limits";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_JSON_BODY = 8192;

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

/** 新建空会话（首条消息前创建） */
export async function POST(req: Request) {
  const untrusted = forbiddenIfUntrustedMutation(req);
  if (untrusted) return untrusted;

  const oversized = rejectIfPayloadTooLarge(req, MAX_JSON_BODY);
  if (oversized) return oversized;

  try {
    const session = await getAuthSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (session.status !== "ACTIVE") {
      return NextResponse.json({ error: "账号待审核或未通过审核" }, { status: 403 });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await req.text() || "{}");
    } catch {
      return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    }

    const parsed = createConversationSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "参数无效", details: parsed.error.flatten() }, { status: 400 });
    }

    const created = await prisma.conversation.create({
      data: {
        userId: session.userId,
        title: parsed.data.title ?? "新对话",
      },
      select: { id: true, title: true, updatedAt: true },
    });

    return NextResponse.json({
      id: created.id,
      title: created.title,
      updatedAt: created.updatedAt.toISOString(),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "创建会话失败" }, { status: 500 });
  }
}
