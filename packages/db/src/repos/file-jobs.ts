import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../client";
import type { AssistantMessageBlock } from "@fambrain/brain-types";

export type FileJobTask = "workspace" | "save_offer";
export type FileJobStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "superseded";

export type FileJobRow = {
  id: string;
  conversationId: string;
  corpusUserId: string;
  fileThreadId: string;
  fileGeneration: number;
  sourceTurnId: string | null;
  sourceMessageId: string | null;
  followupMessageId: string | null;
  task: FileJobTask;
  envelope: Prisma.JsonValue;
  status: FileJobStatus;
  result: Prisma.JsonValue | null;
  pausedAnswer: string | null;
  pausedBlocks: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

const asTask = (raw: string): FileJobTask =>
  raw === "workspace" ? "workspace" : "save_offer";

const asStatus = (raw: string): FileJobStatus => {
  if (
    raw === "pending" ||
    raw === "running" ||
    raw === "paused" ||
    raw === "completed" ||
    raw === "cancelled" ||
    raw === "superseded"
  ) {
    return raw;
  }
  return "cancelled";
};

const mapRow = (row: {
  id: string;
  conversationId: string;
  corpusUserId: string;
  fileThreadId: string;
  fileGeneration: number;
  sourceTurnId: string | null;
  sourceMessageId: string | null;
  followupMessageId: string | null;
  task: string;
  envelope: Prisma.JsonValue;
  status: string;
  result: Prisma.JsonValue | null;
  pausedAnswer: string | null;
  pausedBlocks: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): FileJobRow => ({
  ...row,
  task: asTask(row.task),
  status: asStatus(row.status),
});

export const createFileJob = async (input: {
  id?: string;
  conversationId: string;
  corpusUserId: string;
  fileThreadId: string;
  fileGeneration: number;
  sourceTurnId?: string | null;
  task: FileJobTask;
  envelope: Prisma.InputJsonValue;
}): Promise<FileJobRow> => {
  const row = await prisma.fileJob.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      conversationId: input.conversationId,
      corpusUserId: input.corpusUserId,
      fileThreadId: input.fileThreadId,
      fileGeneration: input.fileGeneration,
      sourceTurnId: input.sourceTurnId ?? null,
      task: input.task,
      envelope: input.envelope,
      status: "paused",
    },
  });
  return mapRow(row);
};

export const getFileJob = async (id: string): Promise<FileJobRow | null> => {
  const row = await prisma.fileJob.findUnique({ where: { id } });
  return row ? mapRow(row) : null;
};

export const listActiveFileJobs = async (
  conversationId: string
): Promise<FileJobRow[]> => {
  const rows = await prisma.fileJob.findMany({
    where: {
      conversationId,
      status: { in: ["pending", "running", "paused"] },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapRow);
};

export const pausedSaveOfferJobIds = async (
  conversationId: string
): Promise<string[]> => {
  const rows = await prisma.fileJob.findMany({
    where: {
      conversationId,
      status: "paused",
      task: "save_offer",
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
};

export const supersedeFileJobs = async (
  conversationId: string,
  opts?: { tasks?: FileJobTask[] }
): Promise<number> => {
  const result = await prisma.fileJob.updateMany({
    where: {
      conversationId,
      status: { in: ["pending", "running", "paused"] },
      ...(opts?.tasks ? { task: { in: opts.tasks } } : {}),
    },
    data: { status: "superseded" },
  });
  return result.count;
};

export const markFileJobPaused = async (input: {
  id: string;
  answer: string;
  blocks?: AssistantMessageBlock[] | null;
}): Promise<void> => {
  await prisma.fileJob.update({
    where: { id: input.id },
    data: {
      status: "paused",
      pausedAnswer: input.answer,
      pausedBlocks: (input.blocks ?? null) as Prisma.InputJsonValue,
    },
  });
};

export const markFileJobTerminal = async (input: {
  id: string;
  status: "completed" | "cancelled";
  result?: Prisma.InputJsonValue | null;
  answer?: string | null;
}): Promise<void> => {
  await prisma.fileJob.update({
    where: { id: input.id },
    data: {
      status: input.status,
      result: input.result ?? undefined,
      pausedAnswer: input.answer ?? undefined,
    },
  });
};

export const attachFileJobFollowup = async (
  id: string,
  followupMessageId: string
): Promise<void> => {
  await prisma.fileJob.update({
    where: { id },
    data: { followupMessageId },
  });
};

export const attachFileJobSourceMessage = async (
  id: string,
  sourceMessageId: string
): Promise<void> => {
  await prisma.fileJob.update({
    where: { id },
    data: { sourceMessageId },
  });
};

export const expireStaleFileJobs = async (
  conversationId: string,
  ttlMs: number
): Promise<string[]> => {
  const cutoff = new Date(Date.now() - ttlMs);
  const stale = await prisma.fileJob.findMany({
    where: {
      conversationId,
      status: "paused",
      updatedAt: { lt: cutoff },
    },
    select: { id: true },
  });
  if (stale.length === 0) return [];
  await prisma.fileJob.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: { status: "cancelled" },
  });
  return stale.map((s) => s.id);
};
