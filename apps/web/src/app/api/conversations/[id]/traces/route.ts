import { getAuthSession } from "@fambrain/auth";
import {
  conversationIdSchema,
  findOwnedConversation,
  listTurnTracesForConversation,
} from "@fambrain/db";
import type { ConversationTurnLog } from "@/lib/chat/conversation-logs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/conversations/[id]/traces
 * 历史 Pipeline 轨迹（timing + steps + agent logs），供运行日志面板回放。
 */
export const GET = async (
  _request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (session.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "账号待审核或未通过审核" },
      { status: 403 }
    );
  }
  const parsedId = conversationIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "无效会话 id" }, { status: 400 });
  }
  try {
    const conversation = await findOwnedConversation(
      parsedId.data,
      session.userId
    );
    if (!conversation) {
      return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    }
    const rows = await listTurnTracesForConversation({
      conversationId: parsedId.data,
      userId: session.userId,
    });
    const turns: ConversationTurnLog[] = rows.map((r) => ({
      turnId: r.messageId,
      userQuestion: r.userQuestion ?? "",
      startedAt: r.createdAt.getTime(),
      status: r.status === "error" ? "error" : "done",
      entries: r.entries,
      steps: r.steps,
      ...(r.timing ? { timing: r.timing } : {}),
      ...(r.error ? { error: r.error } : {}),
    }));
    return NextResponse.json({
      conversationId: parsedId.data,
      turns,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "加载轨迹失败" }, { status: 500 });
  }
};
