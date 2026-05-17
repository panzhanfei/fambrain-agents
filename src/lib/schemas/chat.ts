import { ChatRole } from "@/generated/prisma/client";
import { z } from "zod";

export const conversationIdSchema = z.cuid();

export const createConversationSchema = z.object({
  title: z.string().min(1).max(512).optional(),
});

export const updateConversationSchema = z.object({
  title: z.string().min(1).max(512),
});

export const chatRoleSchema = z.nativeEnum(ChatRole);

export const messageContentSchema = z.string().trim().min(1).max(200_000);

export const messageMetadataSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const createMessageSchema = z.object({
  conversationId: conversationIdSchema,
  role: chatRoleSchema.default(ChatRole.user),
  content: messageContentSchema,
  metadata: messageMetadataSchema,
});

export const listMessagesQuerySchema = z.object({
  conversationId: conversationIdSchema,
  cursor: z.cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});
