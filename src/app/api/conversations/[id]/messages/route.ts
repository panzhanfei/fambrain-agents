import { completeIntakeCoordinator } from "@/agents/IntakeCoordinator";
import { getAgentsConfig } from "@/agents/config";
import { getAuthSession } from "@/lib/auth/session";
import { streamOllamaChat } from "@/lib/chat/ollama-stream";
import { prisma } from "@/lib/prisma";
import { conversationIdSchema, postConversationMessageBodySchema } from "@/lib/schemas/chat";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { rejectIfPayloadTooLarge } from "@/lib/security/request-limits";
import { ChatRole } from "@/generated/prisma/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_JSON_BODY = 221_184;

type UiRole = "user" | "assistant";

function mapRole(role: string): UiRole {
  return role === "user" ? "user" : "assistant";
}

function sliceTitle(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t || "新对话";
  return `${t.slice(0, maxLen)}…`;
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

/**
 * 追加用户消息并生成助手回复。
 * - `stream: false`：`ChatOllama.invoke`（JSON）。
 * - `stream: true`：Ollama 流式 + `think`（SSE：`thinking` → `assistant`，结束后 `done`）。
 * 模型失败时仍会持久化用户消息；非流式返回 502，流式发 `event: error`。
 */
export async function POST(
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

  const parsedBody = postConversationMessageBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "参数无效", details: parsedBody.error.flatten() }, { status: 400 });
  }

  const { content, stream } = parsedBody.data;
  const conversationId = parsedId.data;

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true, title: true },
    });
    if (!conversation || conversation.userId !== session.userId) {
      return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    }

    const userRow = await prisma.message.create({
      data: {
        conversationId,
        role: ChatRole.user,
        content,
      },
      select: { id: true, role: true, content: true },
    });

    if (conversation.title === "新对话") {
      const messageCount = await prisma.message.count({ where: { conversationId } });
      if (messageCount === 1) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { title: sliceTitle(content, 48) },
        });
      }
    }

    const historyRows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });

    const historyForModel = historyRows.map((r) => ({
      role: r.role as "user" | "assistant" | "system",
      content: r.content,
    }));

    if (stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, payload: unknown) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
            );
          };

          try {
            send("meta", {
              userMessage: {
                id: userRow.id,
                role: "user",
                content: userRow.content,
              },
            });

            const out = await streamOllamaChat({
              history: historyForModel,
              think: getAgentsConfig().ollama.streamThink,
              onThinking(full) {
                if (full.trim()) send("thinking", { text: full });
              },
              onContent(full) {
                if (full.trim()) send("assistant", { text: full });
              },
            });

            const finalContent =
              out.content.trim() ||
              "（模型未返回助手文本：请确认 Ollama 已启动且模型已拉取）";

            const assistantRow = await prisma.message.create({
              data: {
                conversationId,
                role: ChatRole.assistant,
                content: finalContent,
              },
              select: { id: true, role: true, content: true },
            });

            send("done", {
              userMessage: {
                id: userRow.id,
                role: mapRole(userRow.role),
                content: userRow.content,
              },
              assistantMessage: {
                id: assistantRow.id,
                role: mapRole(assistantRow.role),
                content: assistantRow.content,
              },
            });
          } catch (e) {
            console.error(e);
            const msg =
              e instanceof Error ? e.message : "模型流式调用失败，请确认本地 Ollama 可用";
            try {
              send("error", { error: msg });
            } catch {
              //
            }
          } finally {
            try {
              controller.close();
            } catch {
              //
            }
          }
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    let assistantText: string;
    try {
      assistantText = await completeIntakeCoordinator(historyForModel);
    } catch (e) {
      console.error(e);
      return NextResponse.json(
        {
          error: "模型调用失败，请确认本地 Ollama 可用",
          userMessage: {
            id: userRow.id,
            role: "user",
            content: userRow.content,
          },
        },
        { status: 502 },
      );
    }

    const assistantRow = await prisma.message.create({
      data: {
        conversationId,
        role: ChatRole.assistant,
        content: assistantText,
      },
      select: { id: true, role: true, content: true },
    });

    return NextResponse.json({
      userMessage: {
        id: userRow.id,
        role: mapRole(userRow.role),
        content: userRow.content,
      },
      assistantMessage: {
        id: assistantRow.id,
        role: mapRole(assistantRow.role),
        content: assistantRow.content,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "保存或处理消息失败" }, { status: 500 });
  }
}
