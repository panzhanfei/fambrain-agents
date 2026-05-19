import { getAuthSession } from "@/lib/auth/session";
import { conversationIdSchema, postConversationMessageBodySchema } from "@/lib/schemas/chat";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { rejectIfPayloadTooLarge } from "@/lib/security/request-limits";
import { createPostMessageStreamResponse } from "@/server/chat/handle-post-message";
import { resolveCorpusUserId } from "@/server/knowledge/resolve-corpus-user";
import {
  findOwnedConversation,
  listConversationMessages,
  toModelHistory,
} from "@/server/db/conversation-messages";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_JSON_BODY = 221_184;

type UiRole = "user" | "assistant";

function mapRole(role: string): UiRole {
  return role === "user" ? "user" : "assistant";
}

/** 会话内消息（按时间正序） */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (session.status !== "ACTIVE") {
    return NextResponse.json({ error: "账号待审核或未通过审核" }, { status: 403 });
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

    const rows = await listConversationMessages(parsedId.data);
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

/** 追加用户消息并流式生成助手回复（SSE） */
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
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

  const parsedId = conversationIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "无效会话 id" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse((await req.text()) || "{}");
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  const parsedBody = postConversationMessageBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsedBody.error.flatten() },
      { status: 400 }
    );
  }

  const conversationId = parsedId.data;
  const { content } = parsedBody.data;

  try {
    const conversation = await findOwnedConversation(
      conversationId,
      session.userId
    );
    if (!conversation) {
      return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    }

    const rows = await listConversationMessages(conversationId);
    const history = toModelHistory(rows);
    const corpusUserId = await resolveCorpusUserId(session.userId);

    return createPostMessageStreamResponse({
      conversationId,
      userContent: content,
      conversationTitle: conversation.title,
      history,
      pipelineContext: {
        actorUserId: session.userId,
        corpusUserId,
        displayName: session.displayName,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "保存或处理消息失败" }, { status: 500 });
  }
}
