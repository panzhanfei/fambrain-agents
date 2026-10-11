import type {
  AgentPipelineContext,
  AgentPipelineResult,
  DbChatTurn,
  AssistantMessageBlock,
  TurnAbortReason,
} from "@fambrain/brain-types";
import { after } from "next/server";
import { encodeSseEvent, sseResponse } from "@/lib/chat/sse";
import {
  appendAssistantMessage,
  appendUserMessage,
  attachFileJobFollowup,
  createFileJob,
  disableConversationActionBlocks,
  getFileJob,
  markFileJobTerminal,
  maybeUpdateConversationTitle,
  pausedSaveOfferJobIds,
  updateAssistantMessage,
  upsertTurnTrace,
} from "@fambrain/db";
import { streamAgentPipeline } from "./brain-service-client";
import {
  appendInflightPreview,
  buildCancelledAssistantContent,
  getInflightTurn,
  registerInflightTurn,
  unregisterInflightTurn,
  type InflightTurn,
} from "./inflight-turns";

type UiRole = "user" | "assistant";
const mapRole = (role: string): UiRole => {
  return role === "user" ? "user" : "assistant";
};
const streamEventName = (ev: { type: string }): string => {
  return ev.type;
};

const persistCancelledTurn = async (
  entry: InflightTurn,
  reason: TurnAbortReason
): Promise<{
  assistantMessage: {
    id: string;
    role: UiRole;
    content: string;
  } | null;
}> => {
  if (entry.finalized) {
    return { assistantMessage: null };
  }
  entry.finalized = true;
  entry.reason = reason;

  let assistantRow: Awaited<ReturnType<typeof appendAssistantMessage>> | null =
    null;
  if (reason === "cancelled") {
    const content = buildCancelledAssistantContent(entry.preview);
    if (content) {
      assistantRow = await appendAssistantMessage(
        entry.conversationId,
        content
      );
    }
  }

  const messageId = assistantRow?.id ?? `turn:${entry.turnId}`;
  try {
    await upsertTurnTrace({
      userId: entry.userId,
      conversationId: entry.conversationId,
      messageId,
      userMessageId: entry.userMessageId,
      userQuestion: entry.userQuestion,
      status: reason,
      timing: entry.timing,
      entries: entry.logs,
      steps: entry.steps,
      error: reason === "cancelled" ? "user_cancelled" : "superseded",
    });
  } catch (traceErr) {
    console.error("upsertTurnTrace (cancel) failed", traceErr);
  }

  return {
    assistantMessage: assistantRow
      ? {
          id: assistantRow.id,
          role: mapRole(assistantRow.role),
          content: assistantRow.content,
        }
      : null,
  };
};

type SseSend = (event: string, payload: unknown) => void;

/**
 * 跑完一轮并落库。SSE 断开（刷新/关页）不中止 Brain；
 * 仅显式 cancel API 会 abort。
 */
const runTurnPipeline = async (input: {
  options: {
    conversationId: string;
    userContent: string;
    pipelineContent: string;
    conversationTitle: string;
    history: DbChatTurn[];
    pipelineContext: AgentPipelineContext;
    authToken: string;
    turnId: string;
    /**
     * 已有用户消息（编辑重跑）：跳过 append；
     * history 须已含该条为末条 user。
     */
    existingUserMessageId?: string;
    /** Resume 原文库 HITL；vault_action 追加按钮对应的用户气泡 */
    resume?: AgentPipelineContext["resume"];
  };
  inflight: InflightTurn;
  send: SseSend;
}): Promise<void> => {
  const { options, inflight, send } = input;
  const turnId = options.turnId;
  const pipelineContent = options.pipelineContent;
  const resume = options.resume;

  try {
    if (!resume) {
      const keepIds = await pausedSaveOfferJobIds(options.conversationId);
      await disableConversationActionBlocks(options.conversationId, {
        keepFileJobIds: keepIds,
      });
    } else {
      await disableConversationActionBlocks(options.conversationId);
    }
  } catch (e) {
    console.error("disableConversationActionBlocks failed", e);
  }

  const silentVaultResume = resume?.kind === "vault_action";
  let userRow: { id: string; role: string; content: string };
  if (options.existingUserMessageId) {
    userRow = {
      id: options.existingUserMessageId,
      role: "user",
      content: options.userContent,
    };
    inflight.userMessageId = userRow.id;
  } else if (silentVaultResume) {
    userRow = {
      id: `vault-resume:${turnId}`,
      role: "user",
      content: options.userContent,
    };
    inflight.userMessageId = userRow.id;
  } else {
    userRow = await appendUserMessage(
      options.conversationId,
      options.userContent
    );
    inflight.userMessageId = userRow.id;
    await maybeUpdateConversationTitle(
      options.conversationId,
      options.conversationTitle,
      options.userContent
    );
  }
  if (!silentVaultResume) {
    send("meta", {
      turnId,
      userMessage: {
        id: userRow.id,
        role: mapRole(userRow.role),
        content: userRow.content,
      },
    });
  }

  // 编辑重跑：history 已含末条 user；普通发送：再拼当前问
  const historyWithUser: DbChatTurn[] = options.existingUserMessageId
    ? options.history
    : [...options.history, { role: "user", content: pipelineContent }];
  const gen = streamAgentPipeline(
    historyWithUser,
    {
      ...options.pipelineContext,
      turnId,
      ...(resume ? { resume } : {}),
    },
    options.authToken,
    { signal: inflight.brainAbort.signal }
  );

  let pipelineResult: AgentPipelineResult | undefined;
  let sawAborted = false;
  let mainCommitted = false;
  let followupCommitted = false;
  let followupRowId: string | null = null;
  while (true) {
    if (inflight.finalized) break;
    const next = await gen.next();
    if (next.done) {
      pipelineResult = next.value;
      break;
    }
    const ev = next.value;
    if (ev.type === "assistant" && typeof ev.text === "string") {
      appendInflightPreview(turnId, ev.text);
    }
    if (ev.type === "pipeline_log" && ev.entry) {
      inflight.logs.push(ev.entry);
    }
    if (ev.type === "step") {
      const idx = inflight.steps.findIndex((s) => s.name === ev.name);
      const step = {
        name: ev.name,
        status: ev.status,
        ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}),
      };
      if (idx >= 0) inflight.steps[idx] = step;
      else inflight.steps.push(step);
    }
    if (ev.type === "pipeline_timing" && ev.timing) {
      inflight.timing = ev.timing;
    }
    if (ev.type === "aborted") {
      sawAborted = true;
      const reason = ev.reason;
      const persisted = await persistCancelledTurn(inflight, reason);
      send("aborted", {
        turnId,
        reason,
        assistantMessage: persisted.assistantMessage,
      });
      continue;
    }
    if (ev.type === "main_turn_complete") {
      const draft = ev.answer?.trim() ?? "";
      if (draft && !mainCommitted) {
        const row = await appendAssistantMessage(options.conversationId, draft, {
          ...(ev.blocks?.length ? { blocks: ev.blocks } : {}),
          ...(ev.citations?.length ? { citations: ev.citations } : {}),
        });
        mainCommitted = true;
        send("main_turn_complete", {
          ...ev,
          assistantMessage: {
            id: row.id,
            role: "assistant",
            content: draft,
            blocks: ev.blocks,
            citations: ev.citations,
          },
        });
      } else {
        send("main_turn_complete", ev);
      }
      continue;
    }
    if (ev.type === "paused") {
      send("paused", ev);
      const jobId = ev.jobId;
      if (jobId && !followupCommitted) {
        let existing = await getFileJob(jobId);
        if (!existing) {
          try {
            existing = await createFileJob({
              id: jobId,
              conversationId: options.conversationId,
              corpusUserId: options.pipelineContext.corpusUserId,
              fileThreadId: `fambrain-file:${options.conversationId}:1`,
              fileGeneration: 1,
              sourceTurnId: turnId,
              task: "workspace",
              envelope: { task: "workspace" },
            });
          } catch (e) {
            console.error("createFileJob failed", e);
          }
        }
        const meta = {
          taskPaused: true,
          pauseKind: "vault_wait" as const,
          fileJobId: jobId,
          ...(ev.blocks?.length ? { blocks: ev.blocks } : {}),
        };
        if (existing?.followupMessageId) {
          await updateAssistantMessage(
            existing.followupMessageId,
            ev.answer,
            meta
          );
          followupRowId = existing.followupMessageId;
        } else {
          const row = await appendAssistantMessage(
            options.conversationId,
            ev.answer,
            meta
          );
          followupRowId = row.id;
          try {
            await attachFileJobFollowup(jobId, row.id);
          } catch (e) {
            console.error("attachFileJobFollowup failed", e);
          }
        }
        followupCommitted = true;
      }
      continue;
    }
    send(streamEventName(ev), ev);
  }

  if (inflight.finalized || sawAborted || pipelineResult?.aborted) {
    if (!inflight.finalized && pipelineResult?.aborted) {
      const reason = pipelineResult.abortReason ?? "cancelled";
      const persisted = await persistCancelledTurn(inflight, reason);
      send("aborted", {
        turnId,
        reason,
        assistantMessage: persisted.assistantMessage,
      });
    } else if (!inflight.finalized && inflight.brainAbort.signal.aborted) {
      const reason: TurnAbortReason = inflight.reason ?? "cancelled";
      const persisted = await persistCancelledTurn(inflight, reason);
      send("aborted", {
        turnId,
        reason,
        assistantMessage: persisted.assistantMessage,
      });
    }
    send("done", {
      turnId,
      aborted: true,
      reason: inflight.reason ?? pipelineResult?.abortReason ?? "cancelled",
      userMessage: {
        id: userRow.id,
        role: mapRole(userRow.role),
        content: userRow.content,
      },
    });
    return;
  }

  if (inflight.brainAbort.signal.aborted && !inflight.finalized) {
    const reason: TurnAbortReason = inflight.reason ?? "cancelled";
    const persisted = await persistCancelledTurn(inflight, reason);
    send("aborted", {
      turnId,
      reason,
      assistantMessage: persisted.assistantMessage,
    });
    send("done", {
      turnId,
      aborted: true,
      reason,
      userMessage: {
        id: userRow.id,
        role: mapRole(userRow.role),
        content: userRow.content,
      },
    });
    return;
  }

  const isPaused = Boolean(pipelineResult?.paused);
  if (
    !followupCommitted &&
    silentVaultResume &&
    resume?.jobId &&
    !isPaused
  ) {
    const existing = await getFileJob(resume.jobId);
    if (existing?.followupMessageId) {
      const closing = pipelineResult?.answer ?? "";
      await updateAssistantMessage(existing.followupMessageId, closing, {
        taskPaused: false,
        fileJobId: resume.jobId,
      });
      try {
        await markFileJobTerminal({
          id: resume.jobId,
          status: "completed",
          answer: closing,
        });
      } catch (e) {
        console.error("markFileJobTerminal failed", e);
      }
      followupRowId = existing.followupMessageId;
      followupCommitted = true;
    }
  }
  if (followupCommitted && followupRowId) {
    inflight.finalized = true;
    send("ready", {
      answer: pipelineResult?.answer ?? "",
      timing: pipelineResult?.timing,
      paused: isPaused,
      pauseKind: pipelineResult?.pauseKind,
      jobId: pipelineResult?.jobId,
    });
    send("done", {
      turnId,
      paused: isPaused,
      pauseKind: pipelineResult?.pauseKind,
      jobId: pipelineResult?.jobId,
      userMessage: {
        id: userRow.id,
        role: mapRole(userRow.role),
        content: userRow.content,
      },
      assistantMessage: {
        id: followupRowId,
        role: "assistant" as const,
        content: pipelineResult?.answer ?? "",
        blocks: pipelineResult?.blocks,
        taskPaused: isPaused,
        pauseKind: pipelineResult?.pauseKind,
        fileJobId: pipelineResult?.jobId,
      },
      timing: pipelineResult?.timing,
    });
    return;
  }
  const finalContent =
    pipelineResult?.answer?.trim() ||
    (isPaused
      ? ""
      : "（模型未返回助手文本：请确认 Ollama 已启动且模型已拉取）");
  appendInflightPreview(turnId, finalContent);
  send("ready", {
    answer: finalContent,
    timing: pipelineResult?.timing,
    paused: isPaused,
    pauseKind: pipelineResult?.pauseKind,
  });
  const assistantMeta = {
    ...(pipelineResult?.retrievalPaths?.length
      ? { retrievalPaths: pipelineResult.retrievalPaths }
      : {}),
    ...(pipelineResult?.blocks?.length
      ? { blocks: pipelineResult.blocks as AssistantMessageBlock[] }
      : {}),
    ...(pipelineResult?.citations?.length
      ? { citations: pipelineResult.citations }
      : {}),
    ...(isPaused
      ? { taskPaused: true, pauseKind: pipelineResult?.pauseKind }
      : {}),
  };
  const assistantRow = await appendAssistantMessage(
    options.conversationId,
    finalContent,
    Object.keys(assistantMeta).length
      ? assistantMeta
      : undefined
  );
  inflight.finalized = true;
  try {
    await upsertTurnTrace({
      userId: options.pipelineContext.actorUserId,
      conversationId: options.conversationId,
      messageId: assistantRow.id,
      userMessageId: userRow.id,
      userQuestion: pipelineContent,
      status: isPaused ? "paused" : "done",
      timing: pipelineResult?.timing ?? null,
      entries: pipelineResult?.logs ?? inflight.logs,
      steps: pipelineResult?.steps ?? inflight.steps,
    });
  } catch (traceErr) {
    console.error("upsertTurnTrace failed", traceErr);
  }
  send("done", {
    turnId,
    paused: isPaused,
    pauseKind: pipelineResult?.pauseKind,
    userMessage: {
      id: userRow.id,
      role: mapRole(userRow.role),
      content: userRow.content,
    },
    assistantMessage: {
      id: assistantRow.id,
      role: mapRole(assistantRow.role),
      content: assistantRow.content,
      retrievalPaths: pipelineResult?.retrievalPaths,
      blocks: pipelineResult?.blocks,
      citations: pipelineResult?.citations,
      taskPaused: isPaused,
      pauseKind: pipelineResult?.pauseKind,
    },
    timing: pipelineResult?.timing,
  });
};

export const createPostMessageStreamResponse = (options: {
  conversationId: string;
  /** 入库与 UI 展示 */
  userContent: string;
  /**
   * 发给 Brain 的当前轮用户正文（可与 userContent 不同，例如 vault UI exact-match prompt）。
   * 缺省 = userContent。
   */
  pipelineContent?: string;
  conversationTitle: string;
  history: DbChatTurn[];
  pipelineContext: AgentPipelineContext;
  authToken: string;
  turnId: string;
  /** 编辑重跑：已存在的用户消息 id，跳过 append */
  existingUserMessageId?: string;
  resume?: AgentPipelineContext["resume"];
}): Response => {
  const turnId = options.turnId;
  const pipelineContent = options.pipelineContent ?? options.userContent;
  const inflight = registerInflightTurn({
    turnId,
    conversationId: options.conversationId,
    userId: options.pipelineContext.actorUserId,
    userQuestion: pipelineContent,
  });

  let sseOpen = true;
  let enqueue: ((event: string, payload: unknown) => void) | null = null;
  const emit: SseSend = (event, payload) => {
    if (!sseOpen || !enqueue) return;
    try {
      enqueue(event, payload);
    } catch {
      sseOpen = false;
    }
  };

  let turnPromise: Promise<void> | null = null;
  const beginTurn = (): Promise<void> => {
    if (turnPromise) return turnPromise;
    turnPromise = runTurnPipeline({
      options: {
        conversationId: options.conversationId,
        userContent: options.userContent,
        pipelineContent,
        conversationTitle: options.conversationTitle,
        history: options.history,
        pipelineContext: options.pipelineContext,
        authToken: options.authToken,
        turnId,
        existingUserMessageId: options.existingUserMessageId,
        resume: options.resume,
      },
      inflight,
      send: emit,
    })
      .catch((e) => {
        if (inflight.brainAbort.signal.aborted || inflight.finalized) return;
        console.error(e);
        emit("error", {
          error:
            e instanceof Error
              ? e.message
              : "模型流式调用失败，请确认本地 Ollama 可用",
        });
      })
      .finally(() => {
        unregisterInflightTurn(turnId);
      });
    return turnPromise;
  };

  // 请求/SSE 结束后仍等待 turn 完成并落库
  after(() => {
    void beginTurn();
  });

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      enqueue = (event, payload) => {
        controller.enqueue(encodeSseEvent(event, payload));
      };
      try {
        await beginTurn();
      } finally {
        try {
          controller.close();
        } catch {
          //
        }
      }
    },
    cancel() {
      // 断线或刷新：只关闭 SSE，不 abort Brain（取消走 cancel API）
      sseOpen = false;
      enqueue = null;
    },
  });
  return sseResponse(readable);
};

/** 供 cancel 路由：中止 Brain fetch + 按 reason 落库 */
export const finalizeInflightTurnCancel = async (input: {
  turnId: string;
  userId: string;
  conversationId: string;
  reason: TurnAbortReason;
}): Promise<{
  ok: boolean;
  found: boolean;
  forbidden?: boolean;
  assistantMessage: {
    id: string;
    role: UiRole;
    content: string;
  } | null;
}> => {
  const turn = getInflightTurn(input.turnId);
  if (!turn) {
    return { ok: true, found: false, assistantMessage: null };
  }
  if (
    turn.userId !== input.userId ||
    turn.conversationId !== input.conversationId
  ) {
    return { ok: false, found: true, forbidden: true, assistantMessage: null };
  }
  turn.reason = input.reason;
  if (!turn.brainAbort.signal.aborted) {
    turn.brainAbort.abort();
  }
  try {
    await disableConversationActionBlocks(input.conversationId);
  } catch (e) {
    console.error("disableConversationActionBlocks (cancel) failed", e);
  }
  const persisted = await persistCancelledTurn(turn, input.reason);
  return {
    ok: true,
    found: true,
    assistantMessage: persisted.assistantMessage,
  };
};
