"use client";

import type {
  PipelineLogEntry,
  PipelineStepName,
  PipelineTiming,
  AssistantMessageBlock,
} from "@fambrain/brain-types";
import {
  chatActionStaleGroupKey,
  isVaultWorkspaceActionPrompt,
  messageActionStaleKey,
  sanitizeClientVaultSaveBasename,
  vaultCreatePromptKind,
  vaultOpenPath,
  withoutVaultBoardStaleKeys,
  type ChatActionPayload,
} from "@/lib/chat/action-lifecycle";
import {
  createTurnLog,
  upsertStep,
  type ConversationLogBundle,
  type ConversationTurnLog,
} from "@/lib/chat/conversation-logs";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useSpeechInput } from "@/components/chat/use-speech-input";
import {
  extractDocuments,
  filesFromInput,
} from "@/lib/documents/extract-documents";
import {
  appendTurnToBundle,
  isPatchConversationPayload,
  parseMessageCitations,
  patchTurnLog,
  shortConversationTitle,
  sortConversationsForSidebar,
  USER_PAUSED_SUFFIX,
} from "./helpers";
import { consumeSse, fetchJson, mutateJson } from "./http";
import type {
  ChatMessage,
  ChatShellModel,
  ChatShellProps,
  ConversationListItem,
  MessageTiming,
  PatchConversationOk,
  PendingAttachment,
  VaultEditorModalState,
  VaultSaveNameModalState,
} from "./interface";
import { STEP_RUNNING_LABELS } from "./timing";

export const useChatShell = ({
  initialConversations,
  viewer,
}: ChatShellProps): ChatShellModel => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversations, setConversations] = useState(initialConversations);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [preferEmptySession, setPreferEmptySession] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messagesRetryTick, setMessagesRetryTick] = useState(0);
  const [draft, setDraft] = useState("");
  /** 最近一次发送出错（文案已入库但助手失败时为模型错误提示） */
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  /** HITL 按钮终态 / 会话作废：同组 prompt 置灰 */
  const [staleActionKeys, setStaleActionKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [vaultSaveNameModal, setVaultSaveNameModal] =
    useState<VaultSaveNameModalState | null>(null);
  const [vaultEditor, setVaultEditor] = useState<VaultEditorModalState | null>(
    null
  );
  const [staleActionConvId, setStaleActionConvId] = useState(
    activeConversationId
  );
  if (staleActionConvId !== activeConversationId) {
    setStaleActionConvId(activeConversationId);
    setStaleActionKeys(new Set());
  }
  /** 用户气泡原地编辑 */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const sendBusyRef = useRef(false);
  const pendingUserTempIdRef = useRef<string | null>(null);
  const isComposingRef = useRef(false);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const [thinkingPanelVisible, setThinkingPanelVisible] = useState(false);
  const [streamThinking, setStreamThinking] = useState("");
  const [streamAnswerPreview, setStreamAnswerPreview] = useState("");
  const [streamBlocks, setStreamBlocks] = useState<AssistantMessageBlock[]>([]);
  const [editingSidebarId, setEditingSidebarId] = useState<string | null>(null);
  const [editSidebarTitleDraft, setEditSidebarTitleDraft] = useState("");
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [conversationLogsById, setConversationLogsById] = useState<
    Map<string, ConversationLogBundle>
  >(() => new Map());
  const attachInputRef = useRef<HTMLInputElement>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamPreviewRef = useRef("");
  /** 刷新后等待后台落库的助手回复：按「会话:末条 userId」限次轮询 */
  const assistPollCountRef = useRef<Map<string, number>>(new Map());
  const [streamingTurnId, setStreamingTurnId] = useState<string | null>(null);
  const speechDraftBaseRef = useRef("");
  const appendSpeechToDraft = useCallback(
    (text: string) => {
      const base = speechDraftBaseRef.current.trim();
      const next = base ? `${base} ${text}` : text;
      speechDraftBaseRef.current = next;
      setDraft(next);
      if (sendError) setSendError(null);
    },
    [sendError]
  );
  const appendInterimSpeechToDraft = useCallback((interim: string) => {
    const base = speechDraftBaseRef.current.trim();
    setDraft(interim ? (base ? `${base} ${interim}` : interim) : base);
  }, []);
  const speech = useSpeechInput({
    onTranscript: appendSpeechToDraft,
    onInterim: appendInterimSpeechToDraft,
    lang: "zh-CN",
  });
  useEffect(() => {
    sendBusyRef.current = sendBusy;
  }, [sendBusy]);
  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);
  /**
   * 模型已出稿即可解锁输入；落库 done 可能更晚。
   * 只改 sendBusy——不碰思考面板/turnId（旧 SSE finally 可能晚于 supersede/编辑重问）。
   */
  const releaseSendLock = useCallback(() => {
    flushSync(() => {
      setSendBusy(false);
    });
  }, []);

  /** 仅当本流仍拥有当前 turn 时清理流式 UI（避免编辑重问后旧流冲掉新思考过程） */
  const clearStreamingUiIfOwned = useCallback(
    (ownedTurnId: string, ownedController: AbortController) => {
      if (abortControllerRef.current === ownedController) {
        abortControllerRef.current = null;
      }
      if (activeTurnIdRef.current !== ownedTurnId) return false;
      activeTurnIdRef.current = null;
      setStreamingTurnId(null);
      setThinkingPanelVisible(false);
      setStreamThinking("");
      setStreamAnswerPreview("");
      setStreamBlocks([]);
      streamPreviewRef.current = "";
      releaseSendLock();
      return true;
    },
    [releaseSendLock]
  );
  const loadConversations = useCallback(async (opts?: { silent?: boolean }) => {
    await Promise.resolve();
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setListLoading(true);
    }
    setListError(null);
    const result =
      await fetchJson<ConversationListItem[]>("/api/conversations");
    if (!silent) {
      setListLoading(false);
    }
    if (result.ok) {
      setConversations(result.data);
    } else {
      setListError(result.error);
      if (!silent) {
        setConversations([]);
      }
    }
  }, []);
  const patchConversation = useCallback(
    async (
      id: string,
      body: {
        title?: string;
        pinned?: boolean;
      }
    ): Promise<boolean> => {
      const result = await mutateJson<typeof body, unknown>(
        `/api/conversations/${id}`,
        "PATCH",
        body
      );
      if (!result.ok) {
        setListError(result.error);
        return false;
      }
      await loadConversations();
      return true;
    },
    [loadConversations]
  );
  /** 置顶：先改本地顺序与状态，失败再回滚 */
  const togglePinOptimistic = useCallback(async (id: string) => {
    let snapshot: ConversationListItem[] = [];
    let nextPinned = false;
    let found = false;
    setListError(null);
    flushSync(() => {
      setConversations((prev) => {
        const t = prev.find((c) => c.id === id);
        if (!t) return prev;
        found = true;
        snapshot = prev.map((c) => ({ ...c }));
        nextPinned = !t.pinned;
        return sortConversationsForSidebar(
          prev.map((c) => (c.id === id ? { ...c, pinned: nextPinned } : c))
        );
      });
    });
    if (!found) return;
    const result = await mutateJson<
      {
        pinned: boolean;
      },
      PatchConversationOk
    >(`/api/conversations/${id}`, "PATCH", { pinned: nextPinned });
    if (!result.ok) {
      flushSync(() => {
        setConversations(snapshot);
      });
      setListError(result.error);
      return;
    }
    const data = result.data;
    if (!isPatchConversationPayload(data)) {
      flushSync(() => {
        setConversations(snapshot);
      });
      setListError("置顶同步失败，请刷新页面");
      return;
    }
    setConversations((cur) =>
      sortConversationsForSidebar(
        cur.map((c) =>
          c.id === id
            ? {
                ...c,
                title: data.title,
                pinned: data.pinned,
                updatedAt: data.updatedAt,
              }
            : c
        )
      )
    );
  }, []);
  const deleteConversationOptimistic = useCallback(
    async (id: string, title: string) => {
      if (sendBusy && activeConversationId === id) {
        setListError("正在生成回复，请稍后再删除");
        return;
      }
      const confirmed = window.confirm(
        `确定删除「${title || "新对话"}」？\n删除后无法恢复。`
      );
      if (!confirmed) return;

      let snapshot: ConversationListItem[] = [];
      let wasActive = false;
      let nextActiveId: string | null = null;
      setListError(null);
      flushSync(() => {
        setConversations((prev) => {
          snapshot = prev.map((c) => ({ ...c }));
          wasActive = activeConversationId === id;
          const remaining = prev.filter((c) => c.id !== id);
          if (wasActive) {
            nextActiveId = remaining[0]?.id ?? null;
            setActiveConversationId(nextActiveId);
            setPreferEmptySession(nextActiveId === null);
            setMessages([]);
            setMessagesError(null);
            setSendError(null);
            setStreamThinking("");
            setStreamAnswerPreview("");
            setThinkingPanelVisible(false);
            pendingUserTempIdRef.current = null;
            setEditingSidebarId(null);
          }
          return sortConversationsForSidebar(remaining);
        });
      });

      const result = await mutateJson<undefined, { ok: boolean }>(
        `/api/conversations/${id}`,
        "DELETE"
      );
      if (!result.ok) {
        flushSync(() => {
          setConversations(snapshot);
          if (wasActive) {
            setActiveConversationId(id);
            setPreferEmptySession(false);
            setMessagesRetryTick((n) => n + 1);
          }
        });
        setListError(result.error);
        return;
      }
    },
    [activeConversationId, sendBusy]
  );
  /** 首轮有数据且无「新会话」偏好时，默认打开最近一条会话 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (preferEmptySession) return;
      if (activeConversationId != null) return;
      const firstId = conversations[0]?.id;
      if (firstId) setActiveConversationId(firstId);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversations, preferEmptySession, activeConversationId]);

  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!activeConversationId) {
        setMessages([]);
        setMessagesLoading(false);
        setMessagesError(null);
        return;
      }
      // 流式进行中不 refetch；sendBusy 可能在首 token 后解除，仍以 streamingTurnId 为准
      if (sendBusy || streamingTurnId != null) {
        return;
      }
      // 已有消息时后台同步，避免用整页 loading 替换当前列表
      const showFullPageLoader = messagesRef.current.length === 0;
      if (showFullPageLoader) {
        setMessagesLoading(true);
      }
      setMessagesError(null);
      const [msgResult, traceResult] = await Promise.all([
        fetchJson<ChatMessage[]>(
          `/api/conversations/${activeConversationId}/messages`
        ),
        fetchJson<ConversationLogBundle>(
          `/api/conversations/${activeConversationId}/traces`
        ),
      ]);
      if (cancelled) return;
      if (showFullPageLoader) {
        setMessagesLoading(false);
      }
      if (msgResult.ok) {
        const timingByMessageId = new Map<string, MessageTiming | undefined>();
        if (traceResult.ok) {
          for (const turn of traceResult.data.turns) {
            if (turn.timing) {
              timingByMessageId.set(turn.turnId, turn.timing);
            }
          }
          setConversationLogsById((prev) => {
            const next = new Map(prev);
            next.set(activeConversationId, {
              conversationId: activeConversationId,
              turns: traceResult.data.turns,
            });
            return next;
          });
        }
        setMessages((prev) => {
          const liveTimingById = new Map(
            prev.filter((m) => m.timing).map((m) => [m.id, m.timing] as const)
          );
          const liveCitationsById = new Map(
            prev
              .filter((m) => m.citations?.length)
              .map((m) => [m.id, m.citations] as const)
          );
          return msgResult.data.map((m) => ({
            ...m,
            timing: liveTimingById.get(m.id) ?? timingByMessageId.get(m.id),
            citations:
              liveCitationsById.get(m.id) ??
              parseMessageCitations(
                (m as { citations?: unknown }).citations
              ),
          }));
        });
        // 刷新后末条是用户消息：后台可能仍在生成，短轮询补齐助手（每条 user 最多 2 次）
        const last = msgResult.data[msgResult.data.length - 1];
        if (last?.role === "user") {
          const pollKey = `${activeConversationId}:${last.id}`;
          const n = assistPollCountRef.current.get(pollKey) ?? 0;
          if (n < 2) {
            assistPollCountRef.current.set(pollKey, n + 1);
            const delay = n === 0 ? 2500 : 7000;
            window.setTimeout(() => {
              if (!cancelled) setMessagesRetryTick((x) => x + 1);
            }, delay);
          }
        }
      } else {
        setMessages([]);
        setMessagesError(msgResult.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConversationId, messagesRetryTick, sendBusy, streamingTurnId]);
  /** 生成中跟随最新一行：外层列表滚到底，避免正文/思考长高后仍卡在旧位置 */
  useLayoutEffect(() => {
    if (messagesLoading) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    const streaming =
      sendBusy &&
      (thinkingPanelVisible ||
        Boolean(streamThinking.trim()) ||
        Boolean(streamAnswerPreview.trim()));
    if (!streaming && messages.length === 0) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [
    messages,
    streamThinking,
    streamAnswerPreview,
    sendBusy,
    thinkingPanelVisible,
    messagesLoading,
  ]);
  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ?? null;
  const activeTitleRaw = activeConversation?.title ?? "新对话";
  const activeTitleShort = shortConversationTitle(activeTitleRaw);
  const startNewChat = useCallback(() => {
    setPreferEmptySession(true);
    setActiveConversationId(null);
    setMessages([]);
    setMessagesError(null);
    setSendError(null);
    setStreamThinking("");
    setStreamAnswerPreview("");
    setStreamBlocks([]);
    setThinkingPanelVisible(false);
    pendingUserTempIdRef.current = null;
    setEditingSidebarId(null);
    setEditSidebarTitleDraft("");
    setDraft("");
    setPendingAttachments([]);
    setUploadNotice(null);
    setStaleActionKeys(new Set());
    setEditingMessageId(null);
    setEditDraft("");
  }, []);

  /** 仅最新一条助手消息的 action 可点；历史气泡一律置灰 */
  const latestAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") return messages[i]!.id;
    }
    return null;
  }, [messages]);
  useEffect(() => {
    const latest = messages.find((m) => m.id === latestAssistantMessageId);
    if (latest?.pauseKind !== "vault_wait") return;
    setStaleActionKeys((prev) => {
      const next = withoutVaultBoardStaleKeys(prev);
      return next === prev ? prev : next;
    });
  }, [latestAssistantMessageId, messages]);
  const turnInFlight = sendBusy || streamingTurnId != null;
  const hasLiveStreamUi =
    Boolean(streamAnswerPreview.trim()) || streamBlocks.length > 0;
  const updateLogsForConversation = useCallback(
    (
      conversationId: string,
      updater: (bundle: ConversationLogBundle) => ConversationLogBundle
    ) => {
      setConversationLogsById((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId) ?? {
          conversationId,
          turns: [],
        };
        next.set(conversationId, updater(existing));
        return next;
      });
    },
    []
  );
  const patchActiveTurnLog = useCallback(
    (
      conversationId: string,
      turnId: string,
      patch: (turn: ConversationTurnLog) => ConversationTurnLog
    ) => {
      updateLogsForConversation(conversationId, (bundle) =>
        patchTurnLog(bundle, turnId, patch)
      );
    },
    [updateLogsForConversation]
  );
  /** 停止生成：当前稿落库为终稿；不 abort SSE，避免被当成 cancel */
  const pauseActiveTurn = useCallback(async () => {
    const turnId = activeTurnIdRef.current;
    const convId = activeConversationId;
    if (!turnId || !convId) return;
    try {
      await fetch(`/api/conversations/${convId}/turns/${turnId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
    } catch {
      //
    }
  }, [activeConversationId]);

  /** 停止当前 turn：显式 cancel API + Abort（supersede 时 reason=superseded） */
  const stopActiveTurn = useCallback(
    async (reason: "cancelled" | "superseded") => {
      const turnId = activeTurnIdRef.current;
      const convId = activeConversationId;
      const controller = abortControllerRef.current;
      if (!turnId) return;
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
      abortControllerRef.current = null;
      let assistantFromServer: ChatMessage | null = null;
      if (convId) {
        try {
          const res = await fetch(
            `/api/conversations/${convId}/turns/${turnId}/cancel`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ reason }),
            }
          );
          if (res.ok) {
            const body = (await res.json()) as {
              assistantMessage?: ChatMessage | null;
            };
            if (
              body.assistantMessage &&
              typeof body.assistantMessage.id === "string" &&
              typeof body.assistantMessage.content === "string"
            ) {
              assistantFromServer = {
                id: body.assistantMessage.id,
                role: "assistant",
                content: body.assistantMessage.content,
              };
            }
          }
        } catch {
          //
        }
        patchActiveTurnLog(convId, turnId, (turn) => ({
          ...turn,
          status: reason,
        }));
      }
      if (reason === "cancelled") {
        const preview = streamPreviewRef.current.trim();
        const fallback =
          preview && !preview.endsWith("用户已暂停")
            ? `${preview}${USER_PAUSED_SUFFIX}`
            : preview || null;
        const assistant =
          assistantFromServer ??
          (fallback
            ? {
                id: `local-cancel:${turnId}`,
                role: "assistant" as const,
                content: fallback,
              }
            : null);
        if (assistant) {
          flushSync(() => {
            setMessages((prev) => {
              const rest = prev.filter(
                (m) =>
                  m.id !== assistant.id && m.id !== `local-cancel:${turnId}`
              );
              return [...rest, assistant];
            });
          });
        }
      }
      activeTurnIdRef.current = null;
      setStreamingTurnId(null);
      streamPreviewRef.current = "";
      setStreamAnswerPreview("");
      setStreamBlocks([]);
      setThinkingPanelVisible(false);
      setStreamThinking("");
      releaseSendLock();
    },
    [activeConversationId, patchActiveTurnLog, releaseSendLock]
  );

  const markStaleActionKey = useCallback((key: string | null | undefined) => {
    if (!key) return;
    setStaleActionKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const sendMessageWithContent = useCallback(
    async (
      content: string,
      options?: {
        displayContent?: string;
        staleGroupKey?: string | null;
        /** 点击的助手消息：整条 actions 作废 */
        staleMessageId?: string | null;
        resume?: {
          kind: "vault_action";
          jobId: string;
          prompt?: string;
          name?: string;
          afterContent?: string;
        };
        omitUserBubble?: boolean;
      }
    ) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const displayContent =
        (options?.displayContent ?? trimmed).trim() || trimmed;
      // 首 token 前 sendBusy 防连点；流式中再发会 supersede（discard）。带 resume 的 vault_action 不 discard。
      if (sendBusy && !streamingTurnId && !options?.resume) return;
      if (!options?.resume && (streamingTurnId || activeTurnIdRef.current)) {
        await stopActiveTurn("superseded");
      }
      setSendBusy(true);
      setSendError(null);
      setUploadNotice(null);
      setStreamThinking("");
      setStreamAnswerPreview("");
      streamPreviewRef.current = "";
      setStreamBlocks([]);
      setThinkingPanelVisible(false);
      // 与 HITL 同套：group key 作废同类按钮。
      // 原文库 Resume 原地更新同一条 followup，不能把 source message 整条标 stale，否则新列表删除/打开也会灰。
      markStaleActionKey(
        options?.staleGroupKey ?? chatActionStaleGroupKey(trimmed)
      );
      if (!options?.resume) {
        const msgToStale =
          options?.staleMessageId ??
          (() => {
            for (let i = messagesRef.current.length - 1; i >= 0; i -= 1) {
              if (messagesRef.current[i]?.role === "assistant") {
                return messagesRef.current[i]!.id;
              }
            }
            return null;
          })();
        if (msgToStale) markStaleActionKey(messageActionStaleKey(msgToStale));
      }

      // 发送即带走附件：先挂到用户气泡并清空输入区芯片（抽取失败也不再留在下方）
      const pendingFiles = [...pendingAttachmentsRef.current];
      const attachNote =
        pendingFiles.length > 0
          ? `\n\n[附件 ${pendingFiles.map((a) => a.name).join("、")}]`
          : "";
      const userBubbleContent = `${displayContent}${attachNote}`;
      setPendingAttachments([]);
      pendingAttachmentsRef.current = [];
      setDraft("");

      const tempUserId = `temp:${crypto.randomUUID()}`;
      pendingUserTempIdRef.current = tempUserId;
      const turnId = crypto.randomUUID();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      activeTurnIdRef.current = turnId;
      setStreamingTurnId(turnId);

      let attachmentBatchId: string | undefined;
      try {
        let convId = activeConversationId;
        if (!convId) {
          const created = await mutateJson<
            Record<string, unknown>,
            {
              id: string;
            }
          >("/api/conversations", "POST", {});
          if (!created.ok) {
            setSendError(created.error);
            pendingUserTempIdRef.current = null;
            activeTurnIdRef.current = null;
            setStreamingTurnId(null);
            abortControllerRef.current = null;
            releaseSendLock();
            return;
          }
          convId = created.data.id;
        }
        setPreferEmptySession(false);
        setActiveConversationId(convId);
        if (!options?.omitUserBubble) {
          setMessages((prev) => [
            ...prev,
            { id: tempUserId, role: "user", content: userBubbleContent },
          ]);
        } else {
          pendingUserTempIdRef.current = null;
        }
        updateLogsForConversation(convId, (bundle) =>
          appendTurnToBundle(bundle, createTurnLog(turnId, userBubbleContent))
        );

        if (pendingFiles.length > 0) {
          setUploadBusy(true);
          setThinkingPanelVisible(true);
          setStreamThinking("正在抽取附件文字…");
          const outcome = await extractDocuments({
            files: pendingFiles.map((a) => ({
              file: a.file,
              relativePath: a.name,
            })),
            signal: controller.signal,
          });
          setUploadBusy(false);
          if (!outcome.ok) {
            setSendError(outcome.error);
            setThinkingPanelVisible(false);
            setStreamThinking("");
            activeTurnIdRef.current = null;
            setStreamingTurnId(null);
            abortControllerRef.current = null;
            releaseSendLock();
            return;
          }
          attachmentBatchId = outcome.result.batchId;
          // 抽取成功后不常驻提示；失败才用 sendError
          setUploadNotice(null);
        }
        type MetaPayload = {
          userMessage: ChatMessage;
        };
        type DonePayload = {
          userMessage?: ChatMessage;
          assistantMessage?: ChatMessage;
          timing?: PipelineTiming;
          aborted?: boolean;
          paused?: boolean;
          pauseKind?: "vault_wait";
          reason?: "cancelled" | "superseded";
        };
        const clientStartedAt = performance.now();
        let latestTiming: PipelineTiming | undefined;
        const res = await fetch(`/api/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            content: userBubbleContent,
            ...(displayContent !== trimmed || attachNote
              ? { routingContent: trimmed }
              : {}),
            turnId,
            ...(attachmentBatchId ? { attachmentBatchId } : {}),
            ...(options?.resume ? { resume: options.resume } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          let msg = `${res.status}`;
          try {
            const raw = await res.json();
            if (raw?.error && typeof raw.error === "string") msg = raw.error;
          } catch {
            //
          }
          setSendError(msg);
          pendingUserTempIdRef.current = null;
          setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
          activeTurnIdRef.current = null;
          setStreamingTurnId(null);
          abortControllerRef.current = null;
          await loadConversations({ silent: true });
          setMessagesRetryTick((n) => n + 1);
          return;
        }
        if (!res.body) {
          setSendError("无法读取服务器流");
          pendingUserTempIdRef.current = null;
          setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
          activeTurnIdRef.current = null;
          setStreamingTurnId(null);
          abortControllerRef.current = null;
          await loadConversations({ silent: true });
          setMessagesRetryTick((n) => n + 1);
          return;
        }
        let streamFatal: string | null = null;
        let streamAborted = false;
        const applyTurnTiming = (
          timing: PipelineTiming,
          clientTotalMs?: number
        ) => {
          const tid = activeTurnIdRef.current;
          if (!tid) return;
          patchActiveTurnLog(convId, tid, (turn) => ({
            ...turn,
            timing: {
              ...timing,
              ...(clientTotalMs != null ? { clientTotalMs } : {}),
            },
          }));
        };
        await consumeSse(
          res.body,
          (event, payload) => {
            if (
              event === "pipeline_log" &&
              payload &&
              typeof payload === "object" &&
              payload !== null
            ) {
              const entry = (payload as { entry?: PipelineLogEntry }).entry;
              if (entry && activeTurnIdRef.current === turnId) {
                patchActiveTurnLog(convId, turnId, (turn) => ({
                  ...turn,
                  entries: [...turn.entries, entry],
                }));
              }
            }
            if (
              event === "meta" &&
              payload &&
              typeof payload === "object" &&
              payload !== null
            ) {
              const p = payload as MetaPayload;
              if (typeof p.userMessage?.id === "string") {
                pendingUserTempIdRef.current = null;
                const real = p.userMessage;
                setMessages((prev) =>
                  prev.map((m) => (m.id === tempUserId ? real : m))
                );
              }
            }
            if (
              event === "ready" &&
              payload &&
              typeof payload === "object" &&
              payload !== null &&
              activeTurnIdRef.current === turnId
            ) {
              const p = payload as {
                answer?: string;
                timing?: PipelineTiming;
              };
              if (p.timing && typeof p.timing.totalMs === "number") {
                latestTiming = p.timing;
                applyTurnTiming(p.timing);
              }
              if (typeof p.answer === "string" && p.answer.trim()) {
                streamPreviewRef.current = p.answer;
                setStreamAnswerPreview(p.answer);
              }
              releaseSendLock();
            }
            if (
              event === "pipeline_timing" &&
              payload &&
              typeof payload === "object" &&
              payload !== null &&
              activeTurnIdRef.current === turnId
            ) {
              const t = (payload as { timing?: PipelineTiming }).timing;
              if (t && typeof t.totalMs === "number") {
                latestTiming = t;
                applyTurnTiming(t);
              }
              releaseSendLock();
            }
            if (
              event === "step" &&
              payload &&
              typeof payload === "object" &&
              payload !== null
            ) {
              const p = payload as {
                name?: string;
                status?: string;
                durationMs?: number;
              };
              if (
                activeTurnIdRef.current === turnId &&
                typeof p.name === "string" &&
                (p.status === "running" || p.status === "done")
              ) {
                patchActiveTurnLog(convId, turnId, (turn) => ({
                  ...turn,
                  steps: upsertStep(turn.steps, {
                    name: p.name as PipelineStepName,
                    status: p.status as "running" | "done",
                    durationMs: p.durationMs,
                  }),
                }));
              }
              if (
                p.status === "running" &&
                typeof p.name === "string" &&
                activeTurnIdRef.current === turnId
              ) {
                setThinkingPanelVisible(true);
                setStreamThinking(STEP_RUNNING_LABELS[p.name] ?? "处理中…");
              }
              if (
                p.status === "done" &&
                p.name === "analyst" &&
                activeTurnIdRef.current === turnId
              ) {
                releaseSendLock();
              }
            }
            if (
              event === "thinking" &&
              payload &&
              typeof payload === "object" &&
              payload !== null
            ) {
              const t = (
                payload as {
                  text?: string;
                }
              ).text;
              if (
                typeof t === "string" &&
                t.trim() &&
                activeTurnIdRef.current === turnId
              ) {
                setThinkingPanelVisible(true);
                setStreamThinking(t);
              }
            }
            if (
              event === "ui_block" &&
              payload &&
              typeof payload === "object" &&
              payload !== null
            ) {
              const block = (payload as { block?: AssistantMessageBlock })
                .block;
              if (
                block &&
                typeof block === "object" &&
                activeTurnIdRef.current === turnId
              ) {
                setStreamBlocks((prev) => [...prev, block]);
              }
            }
            if (
              event === "assistant_message" &&
              payload &&
              typeof payload === "object" &&
              payload !== null
            ) {
              const message = (
                payload as {
                  message?: { blocks?: AssistantMessageBlock[] };
                }
              ).message;
              if (
                message?.blocks?.length &&
                activeTurnIdRef.current === turnId
              ) {
                setStreamBlocks(message.blocks);
              }
            }
            if (
              event === "assistant" &&
              payload &&
              typeof payload === "object" &&
              payload !== null
            ) {
              const t = (
                payload as {
                  text?: string;
                }
              ).text;
              if (typeof t === "string" && activeTurnIdRef.current === turnId) {
                setThinkingPanelVisible(false);
                setStreamThinking("");
                streamPreviewRef.current = t;
                setStreamAnswerPreview(t);
                if (t.trim()) {
                  releaseSendLock();
                }
              }
            }
            if (
              event === "main_turn_complete" &&
              payload &&
              typeof payload === "object" &&
              payload !== null &&
              activeTurnIdRef.current === turnId
            ) {
              const p = payload as {
                assistantMessage?: ChatMessage;
                answer?: string;
              };
              const row = p.assistantMessage;
              if (row && typeof row.id === "string") {
                const assistant: ChatMessage = {
                  id: row.id,
                  role: "assistant",
                  content:
                    typeof row.content === "string"
                      ? row.content
                      : (p.answer ?? ""),
                  createdAt: new Date().toISOString(),
                  blocks: row.blocks,
                  citations: row.citations,
                };
                flushSync(() => {
                  setMessages((prev) => {
                    if (prev.some((m) => m.id === assistant.id)) return prev;
                    return [...prev, assistant];
                  });
                });
                streamPreviewRef.current = "";
                setStreamAnswerPreview("");
                setStreamBlocks([]);
              }
            }
            if (
              event === "aborted" &&
              payload &&
              typeof payload === "object" &&
              payload !== null
            ) {
              streamAborted = true;
              const p = payload as {
                turnId?: string;
                reason?: "cancelled" | "superseded";
                assistantMessage?: ChatMessage;
              };
              const tid = typeof p.turnId === "string" ? p.turnId : turnId;
              const reason = p.reason ?? "cancelled";
              patchActiveTurnLog(convId, tid, (t) => ({
                ...t,
                status: reason,
              }));
              // 已被 supersede/编辑重问接棒：只记账，不碰新 turn 的思考/预览
              if (activeTurnIdRef.current !== turnId) {
                return;
              }
              // cancel 响应已更新 UI 时，仅补齐尚未展示的已停止文本
              if (
                reason === "cancelled" &&
                p.assistantMessage &&
                typeof p.assistantMessage.content === "string"
              ) {
                const assistant: ChatMessage = {
                  id: p.assistantMessage.id,
                  role: "assistant",
                  content: p.assistantMessage.content,
                  createdAt:
                    typeof (p.assistantMessage as { createdAt?: unknown })
                      .createdAt === "string"
                      ? (p.assistantMessage as { createdAt: string }).createdAt
                      : new Date().toISOString(),
                };
                flushSync(() => {
                  setMessages((prev) => {
                    const withoutLocal = prev.filter(
                      (m) => m.id !== `local-cancel:${tid}`
                    );
                    if (withoutLocal.some((m) => m.id === assistant.id)) {
                      return withoutLocal.map((m) =>
                        m.id === assistant.id ? assistant : m
                      );
                    }
                    return [...withoutLocal, assistant];
                  });
                });
              }
              clearStreamingUiIfOwned(turnId, controller);
              pendingUserTempIdRef.current = null;
            }
            if (
              event === "done" &&
              payload &&
              typeof payload === "object" &&
              payload !== null
            ) {
              const p = payload as DonePayload;
              if (p.aborted || streamAborted) {
                patchActiveTurnLog(convId, turnId, (t) => ({
                  ...t,
                  status: p.reason ?? "cancelled",
                }));
                if (activeTurnIdRef.current === turnId) {
                  clearStreamingUiIfOwned(turnId, controller);
                  pendingUserTempIdRef.current = null;
                }
                return;
              }
              if (activeTurnIdRef.current !== turnId) {
                return;
              }
              const clientTotalMs = Math.round(
                performance.now() - clientStartedAt
              );
              const serverTiming = p.timing ?? latestTiming;
              const timing: MessageTiming | undefined = serverTiming
                ? { ...serverTiming, clientTotalMs }
                : undefined;
              if (serverTiming) applyTurnTiming(serverTiming, clientTotalMs);
              const assistantId =
                p.assistantMessage && typeof p.assistantMessage.id === "string"
                  ? p.assistantMessage.id
                  : null;
              patchActiveTurnLog(convId, turnId, (t) => ({
                ...t,
                ...(assistantId ? { turnId: assistantId } : {}),
                status: p.paused ? "paused" : "done",
                timing: timing ?? t.timing,
              }));
              pendingUserTempIdRef.current = null;
              if (
                p.assistantMessage &&
                typeof p.assistantMessage.id === "string" &&
                typeof p.assistantMessage.content === "string"
              ) {
                const assistant: ChatMessage = {
                  id: p.assistantMessage.id,
                  role: "assistant",
                  content: p.assistantMessage.content,
                  createdAt:
                    typeof (p.assistantMessage as { createdAt?: unknown })
                      .createdAt === "string"
                      ? (p.assistantMessage as { createdAt: string }).createdAt
                      : new Date().toISOString(),
                  timing,
                  retrievalPaths: Array.isArray(
                    (p.assistantMessage as { retrievalPaths?: unknown })
                      .retrievalPaths
                  )
                    ? (p.assistantMessage as { retrievalPaths: string[] })
                        .retrievalPaths
                    : undefined,
                  blocks: Array.isArray(
                    (p.assistantMessage as { blocks?: unknown }).blocks
                  )
                    ? (
                        p.assistantMessage as {
                          blocks: AssistantMessageBlock[];
                        }
                      ).blocks
                    : undefined,
                  citations: parseMessageCitations(
                    (p.assistantMessage as { citations?: unknown }).citations
                  ),
                  taskPaused: Boolean(
                    (p.assistantMessage as { taskPaused?: boolean }).taskPaused ??
                      p.paused
                  ),
                  pauseKind:
                    (p.assistantMessage as { pauseKind?: ChatMessage["pauseKind"] })
                      .pauseKind ?? p.pauseKind,
                  fileJobId: (p.assistantMessage as { fileJobId?: string })
                    .fileJobId,
                };
                flushSync(() => {
                  setMessages((prev) => {
                    const rest = prev.filter((m) => m.id !== assistant.id);
                    return [...rest, assistant];
                  });
                });
              }
              clearStreamingUiIfOwned(turnId, controller);
            }
            if (
              event === "error" &&
              payload &&
              typeof payload === "object" &&
              payload !== null
            ) {
              const e =
                (
                  payload as {
                    error?: string;
                    message?: string;
                  }
                ).error ?? (payload as { message?: string }).message;
              streamFatal = typeof e === "string" ? e : "模型出错";
              patchActiveTurnLog(convId, turnId, (t) => ({
                ...t,
                status: "error",
                error: streamFatal ?? undefined,
              }));
              if (activeTurnIdRef.current === turnId) {
                clearStreamingUiIfOwned(turnId, controller);
              }
            }
          },
          controller.signal
        );
        if (streamFatal) {
          setSendError(streamFatal);
        }
        void loadConversations({ silent: true });
        setMessagesRetryTick((n) => n + 1);
      } catch (e) {
        const aborted =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError") ||
          controller.signal.aborted;
        if (!aborted) {
          setSendError("网络错误");
          pendingUserTempIdRef.current = null;
          setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
          clearStreamingUiIfOwned(turnId, controller);
        } else if (activeTurnIdRef.current === turnId) {
          // 本 turn 被 abort 且未接棒：收尾 UI
          clearStreamingUiIfOwned(turnId, controller);
          pendingUserTempIdRef.current = null;
        }
        await loadConversations({ silent: true });
        setMessagesRetryTick((n) => n + 1);
      } finally {
        // supersede / 编辑重问后旧流不得清新 turn
        if (activeTurnIdRef.current === turnId) {
          clearStreamingUiIfOwned(turnId, controller);
          pendingUserTempIdRef.current = null;
        } else if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      activeConversationId,
      clearStreamingUiIfOwned,
      loadConversations,
      markStaleActionKey,
      patchActiveTurnLog,
      releaseSendLock,
      sendBusy,
      stopActiveTurn,
      streamingTurnId,
      updateLogsForConversation,
    ]
  );

  const handleChatAction = useCallback(
    (action: ChatActionPayload) => {
      if (action.clientHandler === "open_editor" || vaultOpenPath(action.prompt)) {
        const rel = vaultOpenPath(action.prompt);
        if (!rel) return;
        setVaultEditor({
          path: rel,
          prompt: action.prompt,
          sourceMessageId: action.sourceMessageId,
          text: "",
          error: null,
          loading: true,
        });
        void fetch(`/api/vault/file?path=${encodeURIComponent(rel)}`, {
          credentials: "same-origin",
        })
          .then(async (res) => {
            const body = (await res.json()) as { text?: string; error?: string };
            setVaultEditor((prev) => {
              if (!prev || prev.path !== rel) return prev;
              if (!res.ok) {
                return {
                  ...prev,
                  loading: false,
                  error: body.error || "读不到这个文件",
                };
              }
              return { ...prev, loading: false, text: body.text ?? "" };
            });
          })
          .catch(() => {
            setVaultEditor((prev) =>
              prev && prev.path === rel
                ? { ...prev, loading: false, error: "读不到这个文件" }
                : prev
            );
          });
        return;
      }
      if (action.clientHandler === "vault_save_name") {
        setVaultSaveNameModal({
          purpose: "save",
          prompt: action.prompt,
          displayText: action.displayText ?? action.label,
          sourceMessageId: action.sourceMessageId,
          name: `untitled-${Date.now().toString(36)}`,
          error: null,
        });
        return;
      }
      const createKind = vaultCreatePromptKind(action.prompt);
      if (createKind) {
        setVaultSaveNameModal({
          purpose: createKind,
          prompt: action.prompt,
          displayText: action.displayText ?? action.label,
          sourceMessageId: action.sourceMessageId,
          name: "",
          error: null,
        });
        return;
      }
      const source = action.sourceMessageId
        ? messagesRef.current.find((m) => m.id === action.sourceMessageId)
        : undefined;
      const jobId = source?.fileJobId;
      const resumeVault = Boolean(jobId) && isVaultWorkspaceActionPrompt(action.prompt);
      void sendMessageWithContent(action.prompt, {
        displayContent: action.displayText ?? action.label,
        staleGroupKey: chatActionStaleGroupKey(action.prompt),
        staleMessageId: action.sourceMessageId ?? null,
        ...(resumeVault ? { omitUserBubble: true } : {}),
        ...(resumeVault && jobId
          ? {
              resume: {
                kind: "vault_action" as const,
                prompt: action.prompt,
                jobId,
              },
            }
          : {}),
      });
    },
    [sendMessageWithContent]
  );

  const setVaultSaveNameDraft = useCallback((name: string) => {
    setVaultSaveNameModal((prev) =>
      prev ? { ...prev, name, error: null } : prev
    );
  }, []);

  const closeVaultSaveNameModal = useCallback(() => {
    setVaultSaveNameModal(null);
  }, []);

  const confirmVaultSaveName = useCallback(() => {
    const modal = vaultSaveNameModal;
    if (!modal) return;
    const name = sanitizeClientVaultSaveBasename(modal.name);
    if (!name) {
      setVaultSaveNameModal({
        ...modal,
        error:
          modal.purpose === "folder"
            ? "请填写文件夹名（不要含 / 或 ..）"
            : "请填写文件名（不要含 / 或 ..）",
      });
      return;
    }
    const jobId = modal.sourceMessageId
      ? messagesRef.current.find((m) => m.id === modal.sourceMessageId)
          ?.fileJobId
      : undefined;
    if (!jobId) {
      setVaultSaveNameModal({
        ...modal,
        error: "请先重新打开原文库",
      });
      return;
    }
    setVaultSaveNameModal(null);
    void sendMessageWithContent(modal.prompt, {
      displayContent: modal.purpose === "save" ? modal.displayText : name,
      staleGroupKey: chatActionStaleGroupKey(modal.prompt),
      staleMessageId: modal.sourceMessageId ?? null,
      omitUserBubble: true,
      resume: {
        kind: "vault_action",
        jobId,
        prompt: modal.prompt,
        name,
      },
    });
  }, [sendMessageWithContent, vaultSaveNameModal]);

  const setVaultEditorText = useCallback((text: string) => {
    setVaultEditor((prev) => (prev ? { ...prev, text, error: null } : prev));
  }, []);

  const closeVaultEditor = useCallback(() => {
    setVaultEditor(null);
  }, []);

  const confirmVaultEditor = useCallback(() => {
    const modal = vaultEditor;
    if (!modal || modal.loading) return;
    const jobId = modal.sourceMessageId
      ? messagesRef.current.find((m) => m.id === modal.sourceMessageId)
          ?.fileJobId
      : undefined;
    if (!jobId) {
      setVaultEditor({ ...modal, error: "请先重新打开原文库" });
      return;
    }
    setVaultEditor(null);
    void sendMessageWithContent(modal.prompt, {
      displayContent: `保存 ${modal.path}`,
      staleGroupKey: chatActionStaleGroupKey(modal.prompt),
      staleMessageId: modal.sourceMessageId ?? null,
      omitUserBubble: true,
      resume: {
        kind: "vault_action",
        jobId,
        prompt: modal.prompt,
        afterContent: modal.text,
      },
    });
  }, [sendMessageWithContent, vaultEditor]);

  const sendMessage = useCallback(async () => {
    await sendMessageWithContent(draft);
  }, [draft, sendMessageWithContent]);

  const canEditUserMessage = useCallback((m: ChatMessage): boolean => {
    if (m.role !== "user") return false;
    if (m.id.startsWith("temp:")) return false;
    // 内部 vault prompt 不提供编辑（展示文案按钮另当别论）
    if (m.content.trim().startsWith("__FAMBRAIN_")) return false;
    return true;
  }, []);

  const beginEditUserMessage = useCallback(
    (m: ChatMessage) => {
      if (!canEditUserMessage(m)) return;
      setEditingMessageId(m.id);
      setEditDraft(m.content);
      setSendError(null);
    },
    [canEditUserMessage]
  );

  const cancelEditUserMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft("");
  }, []);

  /** 原地改用户气泡 → 截断后续 → edit-regenerate SSE */
  const commitEditUserMessage = useCallback(async () => {
    const messageId = editingMessageId;
    const content = editDraft.trim();
    if (!messageId || !content) return;
    const convId = activeConversationId;
    if (!convId) return;
    if (sendBusy && !streamingTurnId) return;

    if (streamingTurnId || activeTurnIdRef.current) {
      await stopActiveTurn("superseded");
    }

    setEditingMessageId(null);
    setEditDraft("");
    setSendBusy(true);
    setSendError(null);
    setStreamThinking("");
    setStreamAnswerPreview("");
    streamPreviewRef.current = "";
    setStreamBlocks([]);
    setThinkingPanelVisible(false);

    // 本地先截断并替换文案
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx < 0) return prev;
      const head = prev.slice(0, idx);
      return [...head, { ...prev[idx]!, content }];
    });

    const turnId = crypto.randomUUID();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeTurnIdRef.current = turnId;
    setStreamingTurnId(turnId);
    updateLogsForConversation(convId, (bundle) =>
      appendTurnToBundle(bundle, createTurnLog(turnId, content))
    );

    type DonePayload = {
      userMessage?: ChatMessage;
      assistantMessage?: ChatMessage;
      timing?: PipelineTiming;
      aborted?: boolean;
      paused?: boolean;
      pauseKind?: "vault_wait";
      reason?: "cancelled" | "superseded";
    };

    try {
      const clientStartedAt = performance.now();
      let latestTiming: PipelineTiming | undefined;
      const res = await fetch(
        `/api/conversations/${convId}/messages/${messageId}/edit-regenerate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ content, turnId }),
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        let msg = `${res.status}`;
        try {
          const raw = await res.json();
          if (raw?.error && typeof raw.error === "string") msg = raw.error;
        } catch {
          //
        }
        setSendError(msg);
        activeTurnIdRef.current = null;
        setStreamingTurnId(null);
        abortControllerRef.current = null;
        await loadConversations({ silent: true });
        setMessagesRetryTick((n) => n + 1);
        return;
      }
      if (!res.body) {
        setSendError("无法读取服务器流");
        activeTurnIdRef.current = null;
        setStreamingTurnId(null);
        abortControllerRef.current = null;
        return;
      }

      let streamFatal: string | null = null;
      let streamAborted = false;
      const applyTurnTiming = (
        timing: PipelineTiming,
        clientTotalMs?: number
      ) => {
        const tid = activeTurnIdRef.current;
        if (!tid) return;
        patchActiveTurnLog(convId, tid, (turn) => ({
          ...turn,
          timing: {
            ...timing,
            ...(clientTotalMs != null ? { clientTotalMs } : {}),
          },
        }));
      };

      await consumeSse(
        res.body,
        (event, payload) => {
          if (
            event === "pipeline_log" &&
            payload &&
            typeof payload === "object" &&
            payload !== null
          ) {
            const entry = (payload as { entry?: PipelineLogEntry }).entry;
            if (entry && activeTurnIdRef.current === turnId) {
              patchActiveTurnLog(convId, turnId, (turn) => ({
                ...turn,
                entries: [...turn.entries, entry],
              }));
            }
          }
          if (
            event === "meta" &&
            payload &&
            typeof payload === "object" &&
            payload !== null
          ) {
            const p = payload as { userMessage?: ChatMessage };
            if (typeof p.userMessage?.id === "string") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === p.userMessage!.id
                    ? { ...m, content: p.userMessage!.content }
                    : m
                )
              );
            }
          }
          if (
            event === "ready" &&
            payload &&
            typeof payload === "object" &&
            payload !== null &&
            activeTurnIdRef.current === turnId
          ) {
            const p = payload as { answer?: string; timing?: PipelineTiming };
            if (p.timing && typeof p.timing.totalMs === "number") {
              latestTiming = p.timing;
              applyTurnTiming(p.timing);
            }
            if (typeof p.answer === "string" && p.answer.trim()) {
              streamPreviewRef.current = p.answer;
              setStreamAnswerPreview(p.answer);
            }
            releaseSendLock();
          }
          if (
            event === "pipeline_timing" &&
            payload &&
            typeof payload === "object" &&
            payload !== null &&
            activeTurnIdRef.current === turnId
          ) {
            const t = (payload as { timing?: PipelineTiming }).timing;
            if (t && typeof t.totalMs === "number") {
              latestTiming = t;
              applyTurnTiming(t);
            }
            releaseSendLock();
          }
          if (
            event === "step" &&
            payload &&
            typeof payload === "object" &&
            payload !== null
          ) {
            const p = payload as {
              name?: string;
              status?: string;
              durationMs?: number;
            };
            if (
              activeTurnIdRef.current === turnId &&
              typeof p.name === "string" &&
              (p.status === "running" || p.status === "done")
            ) {
              patchActiveTurnLog(convId, turnId, (turn) => ({
                ...turn,
                steps: upsertStep(turn.steps, {
                  name: p.name as PipelineStepName,
                  status: p.status as "running" | "done",
                  durationMs: p.durationMs,
                }),
              }));
            }
            if (
              p.status === "running" &&
              typeof p.name === "string" &&
              activeTurnIdRef.current === turnId
            ) {
              setThinkingPanelVisible(true);
              setStreamThinking(STEP_RUNNING_LABELS[p.name] ?? "处理中…");
            }
            if (
              p.status === "done" &&
              p.name === "analyst" &&
              activeTurnIdRef.current === turnId
            ) {
              releaseSendLock();
            }
          }
          if (
            event === "thinking" &&
            payload &&
            typeof payload === "object" &&
            payload !== null
          ) {
            const t = (payload as { text?: string }).text;
            if (
              typeof t === "string" &&
              t.trim() &&
              activeTurnIdRef.current === turnId
            ) {
              setThinkingPanelVisible(true);
              setStreamThinking(t);
            }
          }
          if (
            event === "ui_block" &&
            payload &&
            typeof payload === "object" &&
            payload !== null
          ) {
            const block = (payload as { block?: AssistantMessageBlock }).block;
            if (
              block &&
              typeof block === "object" &&
              activeTurnIdRef.current === turnId
            ) {
              setStreamBlocks((prev) => [...prev, block]);
            }
          }
          if (
            event === "assistant" &&
            payload &&
            typeof payload === "object" &&
            payload !== null
          ) {
            const t = (payload as { text?: string }).text;
            if (typeof t === "string" && activeTurnIdRef.current === turnId) {
              setThinkingPanelVisible(false);
              setStreamThinking("");
              streamPreviewRef.current = t;
              setStreamAnswerPreview(t);
              if (t.trim()) releaseSendLock();
            }
          }
          if (
            event === "main_turn_complete" &&
            payload &&
            typeof payload === "object" &&
            payload !== null &&
            activeTurnIdRef.current === turnId
          ) {
            const p = payload as {
              assistantMessage?: ChatMessage;
              answer?: string;
            };
            const row = p.assistantMessage;
            if (row && typeof row.id === "string") {
              const assistant: ChatMessage = {
                id: row.id,
                role: "assistant",
                content:
                  typeof row.content === "string"
                    ? row.content
                    : (p.answer ?? ""),
                createdAt: new Date().toISOString(),
                blocks: row.blocks,
                citations: row.citations,
              };
              flushSync(() => {
                setMessages((prev) => {
                  if (prev.some((m) => m.id === assistant.id)) return prev;
                  return [...prev, assistant];
                });
              });
              streamPreviewRef.current = "";
              setStreamAnswerPreview("");
              setStreamBlocks([]);
            }
          }
          if (
            event === "aborted" &&
            payload &&
            typeof payload === "object" &&
            payload !== null
          ) {
            streamAborted = true;
            const p = payload as {
              turnId?: string;
              reason?: "cancelled" | "superseded";
            };
            const tid = typeof p.turnId === "string" ? p.turnId : turnId;
            patchActiveTurnLog(convId, tid, (t) => ({
              ...t,
              status: p.reason ?? "cancelled",
            }));
            if (activeTurnIdRef.current === turnId) {
              clearStreamingUiIfOwned(turnId, controller);
            }
          }
          if (
            event === "done" &&
            payload &&
            typeof payload === "object" &&
            payload !== null
          ) {
            const p = payload as DonePayload;
            if (p.aborted || streamAborted) {
              patchActiveTurnLog(convId, turnId, (t) => ({
                ...t,
                status: p.reason ?? "cancelled",
              }));
              if (activeTurnIdRef.current === turnId) {
                clearStreamingUiIfOwned(turnId, controller);
              }
              return;
            }
            if (activeTurnIdRef.current !== turnId) {
              return;
            }
            const clientTotalMs = Math.round(
              performance.now() - clientStartedAt
            );
            const serverTiming = p.timing ?? latestTiming;
            const timing: MessageTiming | undefined = serverTiming
              ? { ...serverTiming, clientTotalMs }
              : undefined;
            if (serverTiming) applyTurnTiming(serverTiming, clientTotalMs);
            const assistantId =
              p.assistantMessage && typeof p.assistantMessage.id === "string"
                ? p.assistantMessage.id
                : null;
            patchActiveTurnLog(convId, turnId, (turn) => ({
              ...turn,
              ...(assistantId ? { turnId: assistantId } : {}),
              status: p.paused ? "paused" : "done",
              timing: timing ?? turn.timing,
            }));
            if (
              p.assistantMessage &&
              typeof p.assistantMessage.id === "string" &&
              typeof p.assistantMessage.content === "string"
            ) {
              const assistant: ChatMessage = {
                id: p.assistantMessage.id,
                role: "assistant",
                content: p.assistantMessage.content,
                timing,
                retrievalPaths: Array.isArray(
                  (p.assistantMessage as { retrievalPaths?: unknown })
                    .retrievalPaths
                )
                  ? (p.assistantMessage as { retrievalPaths: string[] })
                      .retrievalPaths
                  : undefined,
                blocks: Array.isArray(
                  (p.assistantMessage as { blocks?: unknown }).blocks
                )
                  ? (p.assistantMessage as { blocks: AssistantMessageBlock[] })
                      .blocks
                  : undefined,
                citations: parseMessageCitations(
                  (p.assistantMessage as { citations?: unknown }).citations
                ),
                taskPaused: Boolean(
                  (p.assistantMessage as { taskPaused?: boolean }).taskPaused ??
                    p.paused
                ),
                pauseKind:
                  (p.assistantMessage as { pauseKind?: ChatMessage["pauseKind"] })
                    .pauseKind ?? p.pauseKind,
                fileJobId: (p.assistantMessage as { fileJobId?: string })
                  .fileJobId,
              };
              flushSync(() => {
                setMessages((prev) => {
                  const rest = prev.filter((m) => m.id !== assistant.id);
                  return [...rest, assistant];
                });
              });
            }
            clearStreamingUiIfOwned(turnId, controller);
          }
          if (
            event === "error" &&
            payload &&
            typeof payload === "object" &&
            payload !== null
          ) {
            const e =
              (payload as { error?: string; message?: string }).error ??
              (payload as { message?: string }).message;
            streamFatal = typeof e === "string" ? e : "模型出错";
            patchActiveTurnLog(convId, turnId, (t) => ({
              ...t,
              status: "error",
              error: streamFatal ?? undefined,
            }));
            if (activeTurnIdRef.current === turnId) {
              clearStreamingUiIfOwned(turnId, controller);
            }
          }
        },
        controller.signal
      );

      if (streamFatal) setSendError(streamFatal);
      void loadConversations({ silent: true });
      setMessagesRetryTick((n) => n + 1);
    } catch (e) {
      const aborted =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError") ||
        controller.signal.aborted;
      if (!aborted) {
        setSendError("网络错误");
        clearStreamingUiIfOwned(turnId, controller);
      } else if (activeTurnIdRef.current === turnId) {
        clearStreamingUiIfOwned(turnId, controller);
      }
      await loadConversations({ silent: true });
      setMessagesRetryTick((n) => n + 1);
    } finally {
      if (activeTurnIdRef.current === turnId) {
        clearStreamingUiIfOwned(turnId, controller);
      } else if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [
    activeConversationId,
    clearStreamingUiIfOwned,
    editDraft,
    editingMessageId,
    loadConversations,
    patchActiveTurnLog,
    releaseSendLock,
    sendBusy,
    stopActiveTurn,
    streamingTurnId,
    updateLogsForConversation,
  ]);

  const applySuggestion = (text: string) => {
    setDraft(text);
    setSendError(null);
  };
  /** 「+」仅本地挂起；发送时再抽取（取消不耗 OCR） */
  const handleAttachPick = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length || uploadBusy || sendBusy) return;
      setUploadNotice(null);
      const items = filesFromInput(fileList);
      setPendingAttachments((prev) => {
        const next = [...prev];
        for (const item of items) {
          if (next.length >= 20) break;
          next.push({
            id: crypto.randomUUID(),
            file: item.file,
            name: item.file.name,
            size: item.file.size,
          });
        }
        return next;
      });
    },
    [sendBusy, uploadBusy]
  );
  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);
  const isFreshNewChatUi =
    activeConversationId == null && !messagesLoading && messages.length === 0;
  /** 新开对话且尚未选定会话时的欢迎区 */
  const showingEmptyLanding = isFreshNewChatUi && !sendBusy;
  const activeLogBundle =
    activeConversationId != null
      ? (conversationLogsById.get(activeConversationId) ?? {
          conversationId: activeConversationId,
          turns: [],
        })
      : null;
  /** 首条消息已发出、会话尚在创建或模型推理中 */
  const sendingFirstOnNewChat =
    activeConversationId == null && sendBusy && messages.length === 0;
  const showAssistantPending =
    sendBusy &&
    !streamThinking.trim() &&
    !streamAnswerPreview.trim() &&
    !(
      messages.length > 0 && messages[messages.length - 1]?.role === "assistant"
    );

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    listLoading,
    listError,
    conversations,
    loadConversations,
    activeConversationId,
    setActiveConversationId,
    editingSidebarId,
    setEditingSidebarId,
    editSidebarTitleDraft,
    setEditSidebarTitleDraft,
    patchConversation,
    setPreferEmptySession,
    setStaleActionKeys,
    setStreamThinking,
    setStreamAnswerPreview,
    setStreamBlocks,
    togglePinOptimistic,
    deleteConversationOptimistic,
    viewer,
    startNewChat,
    activeConversation,
    activeTitleRaw,
    activeTitleShort,
    logPanelOpen,
    setLogPanelOpen,
    activeLogBundle,
    streamingTurnId,
    sendingFirstOnNewChat,
    showingEmptyLanding,
    applySuggestion,
    messagesLoading,
    messages,
    messagesError,
    setMessagesRetryTick,
    messagesScrollRef,
    handleChatAction,
    vaultSaveNameModal,
    setVaultSaveNameDraft,
    closeVaultSaveNameModal,
    confirmVaultSaveName,
    vaultEditor,
    setVaultEditorText,
    closeVaultEditor,
    confirmVaultEditor,
    staleActionKeys,
    turnInFlight,
    hasLiveStreamUi,
    latestAssistantMessageId,
    editingMessageId,
    editDraft,
    setEditDraft,
    cancelEditUserMessage,
    commitEditUserMessage,
    sendBusy,
    canEditUserMessage,
    beginEditUserMessage,
    thinkingPanelVisible,
    streamThinking,
    streamAnswerPreview,
    streamBlocks,
    sendError,
    uploadNotice,
    speech,
    draft,
    setDraft,
    speechDraftBaseRef,
    setSendError,
    isComposingRef,
    pendingAttachments,
    sendMessage,
    uploadBusy,
    removePendingAttachment,
    attachInputRef,
    handleAttachPick,
    pauseActiveTurn,
    showAssistantPending,
  };
};
