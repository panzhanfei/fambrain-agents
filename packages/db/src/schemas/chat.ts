import { ChatRole } from "../generated/prisma/client";
import { z } from "zod";
export const conversationIdSchema = z.cuid();
export const createConversationSchema = z.object({
    title: z.string().min(1).max(512).optional(),
});
export const updateConversationSchema = z.object({
    title: z.string().min(1).max(512),
});
/** PATCH /api/conversations/:id — 可单独改标题、单独改置顶，或二者同时传 */
export const patchConversationSchema = z
    .object({
    title: z.string().min(1).max(512).optional(),
    pinned: z.boolean().optional(),
})
    .refine((d) => d.title !== undefined || d.pinned !== undefined, {
    message: "至少需要 title 或 pinned 之一",
});
export const chatRoleSchema = z.nativeEnum(ChatRole);
export const messageContentSchema = z.string().trim().min(1).max(200000);
export const messageMetadataSchema = z.record(z.string(), z.unknown()).nullable().optional();
export const createMessageSchema = z.object({
    conversationId: conversationIdSchema,
    role: chatRoleSchema.default(ChatRole.user),
    content: messageContentSchema,
    metadata: messageMetadataSchema,
});
/** POST /api/conversations/:id/messages — 追加用户提问并以 SSE 流式返回助手回复 */
export const postConversationMessageBodySchema = z.object({
    /** 入库 / UI 展示文案（HITL 按钮应为「确定新建」等，非内部 prompt） */
    content: messageContentSchema,
    /**
     * 可选：发给 Brain / Intake 的路由正文（如 exact-match prompt）。
     * 有则管道用本字段，库内仍存 content。
     */
    routingContent: messageContentSchema.optional(),
    /** Web 生成的 turnId，贯穿 BFF → Brain；缺省时服务端兜底 */
    turnId: z.string().uuid().optional(),
    /**
     * 聊天附件批次（先 POST /api/documents/extract）。
     * Brain 按 id 取已抽取文本；勿在 JSON 里塞全文。
     */
    attachmentBatchId: z.string().uuid().optional(),
    /**
     * vault_wait 的 Resume 载荷；有则走 Command。gen_pause 不使用。
     */
    resume: z
        .object({
            kind: z.enum(["vault_action"]),
            jobId: z.string().min(1),
            prompt: z.string().optional(),
            name: z.string().max(120).optional(),
            afterContent: z.string().max(200_000).optional(),
        })
        .optional(),
});

/** POST …/messages/:messageId/edit-regenerate — 原地改用户问并重跑 */
export const editRegenerateMessageBodySchema = z.object({
    content: messageContentSchema,
    turnId: z.string().uuid().optional(),
});

/** POST /api/conversations/:id/turns/:turnId/cancel */
export const cancelTurnBodySchema = z.object({
    reason: z.enum(["cancelled", "superseded"]).default("cancelled"),
});

export const turnIdParamSchema = z.string().uuid();
export const listMessagesQuerySchema = z.object({
    conversationId: conversationIdSchema,
    cursor: z.cuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});
