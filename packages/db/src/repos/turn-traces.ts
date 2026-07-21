import type {
  PipelineLogEntry,
  PipelineTiming,
  TurnStepEvent,
} from "@fambrain/brain-types";
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../client";

export type UpsertTurnTraceInput = {
  userId: string;
  conversationId: string;
  messageId: string;
  userMessageId?: string | null;
  userQuestion?: string | null;
  status?: "done" | "error";
  timing?: PipelineTiming | null;
  entries: PipelineLogEntry[];
  steps: TurnStepEvent[];
  error?: string | null;
};

export type TurnTraceRow = {
  id: string;
  messageId: string;
  userMessageId: string | null;
  userQuestion: string | null;
  status: string;
  timing: PipelineTiming | null;
  entries: PipelineLogEntry[];
  steps: TurnStepEvent[];
  error: string | null;
  createdAt: Date;
};

const asTiming = (v: unknown): PipelineTiming | null => {
  if (!v || typeof v !== "object") return null;
  return v as PipelineTiming;
};

const asEntries = (v: unknown): PipelineLogEntry[] =>
  Array.isArray(v) ? (v as PipelineLogEntry[]) : [];

const asSteps = (v: unknown): TurnStepEvent[] =>
  Array.isArray(v) ? (v as TurnStepEvent[]) : [];

export const upsertTurnTrace = async (
  input: UpsertTurnTraceInput
): Promise<void> => {
  const data = {
    userId: input.userId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    userMessageId: input.userMessageId ?? null,
    userQuestion: input.userQuestion ?? null,
    status: input.status ?? "done",
    timing: (input.timing ?? null) as Prisma.InputJsonValue,
    entries: input.entries as unknown as Prisma.InputJsonValue,
    steps: input.steps as unknown as Prisma.InputJsonValue,
    error: input.error ?? null,
  };
  await prisma.turnTrace.upsert({
    where: { messageId: input.messageId },
    create: data,
    update: {
      userMessageId: data.userMessageId,
      userQuestion: data.userQuestion,
      status: data.status,
      timing: data.timing,
      entries: data.entries,
      steps: data.steps,
      error: data.error,
    },
  });
};

export const listTurnTracesForConversation = async (input: {
  conversationId: string;
  userId: string;
}): Promise<TurnTraceRow[]> => {
  const owned = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, userId: true },
  });
  if (!owned || owned.userId !== input.userId) return [];

  const rows = await prisma.turnTrace.findMany({
    where: { conversationId: input.conversationId, userId: input.userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    messageId: r.messageId,
    userMessageId: r.userMessageId,
    userQuestion: r.userQuestion,
    status: r.status,
    timing: asTiming(r.timing),
    entries: asEntries(r.entries),
    steps: asSteps(r.steps),
    error: r.error,
    createdAt: r.createdAt,
  }));
};

export const getTurnTraceByMessage = async (input: {
  conversationId: string;
  messageId: string;
  userId: string;
}): Promise<TurnTraceRow | null> => {
  const owned = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, userId: true },
  });
  if (!owned || owned.userId !== input.userId) return null;

  const r = await prisma.turnTrace.findFirst({
    where: {
      conversationId: input.conversationId,
      messageId: input.messageId,
      userId: input.userId,
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    messageId: r.messageId,
    userMessageId: r.userMessageId,
    userQuestion: r.userQuestion,
    status: r.status,
    timing: asTiming(r.timing),
    entries: asEntries(r.entries),
    steps: asSteps(r.steps),
    error: r.error,
    createdAt: r.createdAt,
  };
};
