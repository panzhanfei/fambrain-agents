import { getAuthSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { conversationIdSchema, patchConversationSchema } from "@/lib/schemas/chat";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { rejectIfPayloadTooLarge } from "@/lib/security/request-limits";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_JSON_BODY = 8192;

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const untrusted = forbiddenIfUntrustedMutation(req);
  if (untrusted) return untrusted;

  const oversized = rejectIfPayloadTooLarge(req, MAX_JSON_BODY);
  if (oversized) return oversized;

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

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(await req.text() || "{}");
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  const parsed = patchConversationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const conversationId = parsedId.data;

  try {
    const exists = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });

    if (!exists || exists.userId !== session.userId) {
      return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    }

    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
      },
      select: {
        id: true,
        title: true,
        pinned: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      pinned: updated.pinned,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "更新会话失败" }, { status: 500 });
  }
}
