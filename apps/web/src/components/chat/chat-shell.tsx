"use client";
import type { ConversationListItem } from "@fambrain/db";
import type { PipelineStepName, PipelineTiming } from "@fambrain/agent-types";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useSpeechInput } from "@/components/chat/use-speech-input";

type MessageTiming = PipelineTiming & {
  clientTotalMs?: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timing?: MessageTiming;
};

const STEP_TIMING_LABELS: Record<PipelineStepName, string> = {
  intake: "理解问题",
  user_fact: "读取记忆",
  retrieval: "检索知识库",
  fact_checker: "核查证据",
  content_summarizer: "生成摘要",
  content_organizer: "整理证据",
  analyst: "生成回答",
};

const formatDuration = (ms: number): string => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
};

/** 顶栏/侧栏展示：取首句并截断（纯 UI，不依赖 db） */
const shortConversationTitle = (title: string, maxLen = 18): string => {
  const trimmed = title.trim() || "新对话";
  if (trimmed === "新对话") return trimmed;
  const first =
    trimmed.split(/[？?\n;；，,、]/)[0]?.trim() || trimmed;
  if (first.length <= maxLen) return first;
  return `${first.slice(0, maxLen)}…`;
};

const MessageTimingLine = ({ timing }: { timing: MessageTiming }) => {
  const [expanded, setExpanded] = useState(false);
  const nodeEntries = (
    Object.entries(timing.nodes ?? {}) as [PipelineStepName, number][]
  ).filter(([, ms]) => ms > 0);

  return (
    <div className="mt-1.5 text-[11px] leading-snug text-[#9ca3af]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-left hover:text-[#6b7280]"
      >
        用时 {formatDuration(timing.totalMs)}
        {timing.ttftMs != null
          ? ` · 首字 ${formatDuration(timing.ttftMs)}`
          : ""}
        {timing.clientTotalMs != null
          ? ` · 全链路 ${formatDuration(timing.clientTotalMs)}`
          : ""}
        {nodeEntries.length > 0 ? (expanded ? " ▴" : " ▾") : ""}
      </button>
      {expanded && nodeEntries.length > 0 ? (
        <ul className="mt-1 space-y-0.5 pl-2">
          {nodeEntries.map(([name, ms]) => (
            <li key={name}>
              {STEP_TIMING_LABELS[name] ?? name} {formatDuration(ms)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
type PatchConversationOk = {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
};
const isPatchConversationPayload = (v: unknown): v is PatchConversationOk => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.pinned === "boolean" &&
    typeof o.updatedAt === "string"
  );
};
const sortConversationsForSidebar = (
  items: ConversationListItem[]
): ConversationListItem[] => {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
};
const AssistantPendingRow = () => {
  return (
    <li className="flex justify-start" aria-live="polite">
      <div className="flex items-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-2.5 text-[14px] text-[#6b7280] shadow-sm">
        <span
          className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#e5e7eb] border-t-[#4f46e5]"
          aria-hidden
        />
        <span>正在生成回复</span>
        <span className="inline-flex items-center gap-0.5" aria-hidden>
          {[0, 120, 240].map((delayMs) => (
            <span
              key={delayMs}
              className="inline-block h-1 w-1 animate-pulse rounded-full bg-[#9ca3af]"
              style={{ animationDelay: `${delayMs}ms` }}
            />
          ))}
        </span>
      </div>
    </li>
  );
};
const SUGGESTIONS = [
  "AI Agent 的核心工作原理是什么？",
  "用通俗语言解释大模型微调",
  "帮我写一份工作周报提纲",
  "推荐几本系统设计的入门资料",
];
const IconChat = ({ className }: { className?: string }) => {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </svg>
  );
};
const IconSidebarToggle = ({ className }: { className?: string }) => {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <rect x="3" y="4" width="18" height="6" rx="1" />
      <rect x="3" y="14" width="12" height="6" rx="1" />
    </svg>
  );
};
const IconPlus = ({ className }: { className?: string }) => {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
};
const IconMic = ({ className }: { className?: string }) => {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"
        strokeLinejoin="round"
      />
      <path d="M19 11a7 7 0 0 1-14 0" strokeLinecap="round" />
      <path d="M12 19v3" strokeLinecap="round" />
    </svg>
  );
};
const IconPin = ({
  active,
  className,
}: {
  active?: boolean;
  className?: string;
}) => {
  return (
    <svg
      className={className}
      width={17}
      height={17}
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2.7 14.02 9.06l7.06.61-5.41 4.62 1.71 6.93L12 18.56l-6.39 4.67 1.71-6.93-5.41-4.61 7.06-.61L12 2.7z" />
    </svg>
  );
};
const IconEditTitle = ({ className }: { className?: string }) => {
  return (
    <svg
      className={className}
      width={17}
      height={17}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m15.2 6.9 3.9-4L21 3l-.9 2-3.9 4M13 10l8-9-5-5-8 9v5h5Z"
      />
    </svg>
  );
};
const IconTrash = ({ className }: { className?: string }) => {
  return (
    <svg
      className={className}
      width={17}
      height={17}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path strokeLinecap="round" d="M4 7h16" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"
      />
    </svg>
  );
};
const fetchJson = async <T,>(
  url: string
): Promise<
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    }
> => {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        const body = await res.json();
        if (body?.error && typeof body.error === "string") msg = body.error;
      } catch {
        //
      }
      return { ok: false, error: msg };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, error: "网络错误" };
  }
};
const consumeSse = async (
  stream: ReadableStream<Uint8Array>,
  handle: (event: string, payload: unknown) => void
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n\n");
        if (idx < 0) break;
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let eventName = "message";
        let dataPayload = "";
        const lines = raw.split("\n").filter(Boolean);
        for (const ln of lines) {
          if (ln.startsWith("event:"))
            eventName = ln.slice("event:".length).trim();
          else if (ln.startsWith("data:"))
            dataPayload = ln.slice("data:".length).trim();
        }
        if (dataPayload) {
          let parsed: unknown = dataPayload;
          try {
            parsed = JSON.parse(dataPayload);
          } catch {
            //
          }
          handle(eventName, parsed);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
};
const mutateJson = async <B, R>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: B
): Promise<
  | {
      ok: true;
      data: R;
    }
  | {
      ok: false;
      error: string;
      status: number;
    }
> => {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      //
    }
    let msg = `${res.status}`;
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (
        parsed as {
          error?: unknown;
        }
      ).error === "string"
    ) {
      msg = (
        parsed as {
          error: string;
        }
      ).error;
    }
    if (!res.ok) {
      return { ok: false, error: msg, status: res.status };
    }
    return { ok: true, data: parsed as R };
  } catch {
    return { ok: false, error: "网络错误", status: 0 };
  }
};
type ChatShellProps = {
  initialConversations: ConversationListItem[];
  viewer?: {
    displayName: string;
    username: string;
    /** 是否为系统里的 ADMIN 角色（首个注册.bootstrap） */
    isAdmin: boolean;
    /** 身份证号匹配后缀时：可审核 / 删除成员 */
    canManageMembers: boolean;
  };
};
export const ChatShell = ({ initialConversations, viewer }: ChatShellProps) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversations, setConversations] = useState(initialConversations);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [preferEmptySession, setPreferEmptySession] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messagesRetryTick, setMessagesRetryTick] = useState(0);
  const [draft, setDraft] = useState("");
  /** 最近一次发送出错（文案已入库但助手失败时为模型错误提示） */
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const sendBusyRef = useRef(false);
  const pendingUserTempIdRef = useRef<string | null>(null);
  const isComposingRef = useRef(false);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const [thinkingPanelVisible, setThinkingPanelVisible] = useState(false);
  const [streamThinking, setStreamThinking] = useState("");
  const [streamAnswerPreview, setStreamAnswerPreview] = useState("");
  const [editingSidebarId, setEditingSidebarId] = useState<string | null>(null);
  const [editSidebarTitleDraft, setEditSidebarTitleDraft] = useState("");
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
  /** 模型已出稿即可解锁输入；落库 done 可能更晚 */
  const releaseSendLock = useCallback(() => {
    flushSync(() => {
      setSendBusy(false);
      setThinkingPanelVisible(false);
      setStreamThinking("");
    });
  }, []);
  const loadConversations = useCallback(async () => {
    await Promise.resolve();
    setListLoading(true);
    setListError(null);
    const result =
      await fetchJson<ConversationListItem[]>("/api/conversations");
    setListLoading(false);
    if (result.ok) {
      setConversations(result.data);
    } else {
      setListError(result.error);
      setConversations([]);
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
      if (sendBusy) {
        return;
      }
      setMessagesLoading(true);
      setMessagesError(null);
      const result = await fetchJson<ChatMessage[]>(
        `/api/conversations/${activeConversationId}/messages`
      );
      if (cancelled) return;
      setMessagesLoading(false);
      if (result.ok) {
        setMessages((prev) => {
          const timingById = new Map(
            prev.filter((m) => m.timing).map((m) => [m.id, m.timing] as const)
          );
          return result.data.map((m) => ({
            ...m,
            timing: timingById.get(m.id),
          }));
        });
      } else {
        setMessages([]);
        setMessagesError(result.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConversationId, messagesRetryTick, sendBusy]);
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
    setThinkingPanelVisible(false);
    pendingUserTempIdRef.current = null;
    setEditingSidebarId(null);
    setEditSidebarTitleDraft("");
    setDraft("");
  }, []);
  const sendMessage = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || sendBusy) return;
    setSendBusy(true);
    setSendError(null);
    setStreamThinking("");
    setStreamAnswerPreview("");
    setThinkingPanelVisible(false);
    const tempUserId = `temp:${crypto.randomUUID()}`;
    pendingUserTempIdRef.current = tempUserId;
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
          return;
        }
        convId = created.data.id;
      }
      setDraft("");
      setPreferEmptySession(false);
      setActiveConversationId(convId);
      setMessages((prev) => [
        ...prev,
        { id: tempUserId, role: "user", content: trimmed },
      ]);
      type MetaPayload = {
        userMessage: ChatMessage;
      };
      type DonePayload = {
        userMessage?: ChatMessage;
        assistantMessage?: ChatMessage;
        timing?: PipelineTiming;
      };
      const clientStartedAt = performance.now();
      let latestTiming: PipelineTiming | undefined;
      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ content: trimmed }),
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
        await loadConversations();
        setMessagesRetryTick((n) => n + 1);
        return;
      }
      if (!res.body) {
        setSendError("无法读取服务器流");
        pendingUserTempIdRef.current = null;
        setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
        await loadConversations();
        setMessagesRetryTick((n) => n + 1);
        return;
      }
      let streamFatal: string | null = null;
      await consumeSse(res.body, (event, payload) => {
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
          payload !== null
        ) {
          const p = payload as {
            answer?: string;
            timing?: PipelineTiming;
          };
          if (p.timing && typeof p.timing.totalMs === "number") {
            latestTiming = p.timing;
          }
          if (typeof p.answer === "string" && p.answer.trim()) {
            setStreamAnswerPreview(p.answer);
          }
          releaseSendLock();
        }
        if (
          event === "pipeline_timing" &&
          payload &&
          typeof payload === "object" &&
          payload !== null
        ) {
          const t = (payload as { timing?: PipelineTiming }).timing;
          if (t && typeof t.totalMs === "number") {
            latestTiming = t;
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
          };
          if (p.status === "running" && typeof p.name === "string") {
            const labels: Record<string, string> = {
              intake: "理解问题…",
              user_fact: "读取记忆…",
              retrieval: "检索知识库…",
              fact_checker: "核查证据…",
              content_summarizer: "生成摘要…",
              content_organizer: "整理证据…",
              analyst: "生成回答…",
            };
            setThinkingPanelVisible(true);
            setStreamThinking(labels[p.name] ?? "处理中…");
          }
          if (p.status === "done" && p.name === "analyst") {
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
          if (typeof t === "string" && t.trim()) {
            setThinkingPanelVisible(true);
            setStreamThinking(t);
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
          if (typeof t === "string") {
            setThinkingPanelVisible(false);
            setStreamThinking("");
            setStreamAnswerPreview(t);
            if (t.trim()) {
              releaseSendLock();
            }
          }
        }
        if (
          event === "done" &&
          payload &&
          typeof payload === "object" &&
          payload !== null
        ) {
          const p = payload as DonePayload;
          const clientTotalMs = Math.round(performance.now() - clientStartedAt);
          const serverTiming = p.timing ?? latestTiming;
          const timing: MessageTiming | undefined = serverTiming
            ? { ...serverTiming, clientTotalMs }
            : undefined;
          pendingUserTempIdRef.current = null;
          releaseSendLock();
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
            };
            flushSync(() => {
              setMessages((prev) => {
                const rest = prev.filter((m) => m.id !== assistant.id);
                return [...rest, assistant];
              });
              setStreamAnswerPreview("");
            });
          } else {
            setStreamAnswerPreview("");
          }
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
          releaseSendLock();
        }
      });
      if (streamFatal) {
        setSendError(streamFatal);
      }
      void loadConversations();
      setMessagesRetryTick((n) => n + 1);
    } catch {
      setSendError("网络错误");
      pendingUserTempIdRef.current = null;
      setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
      await loadConversations();
      setMessagesRetryTick((n) => n + 1);
    } finally {
      if (sendBusyRef.current) {
        releaseSendLock();
      }
      setStreamAnswerPreview("");
      pendingUserTempIdRef.current = null;
    }
  }, [activeConversationId, draft, loadConversations, releaseSendLock]);
  const applySuggestion = (text: string) => {
    setDraft(text);
    setSendError(null);
  };
  const isFreshNewChatUi =
    activeConversationId == null && !messagesLoading && messages.length === 0;
  /** 新开对话且尚未选定会话时的欢迎区 */
  const showingEmptyLanding = isFreshNewChatUi && !sendBusy;
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
  return (
    <div className="flex h-dvh bg-[#f3f4f6] text-[#1f2937]">
      <aside
        className={[
          "flex shrink-0 flex-col border-r border-[#e5e7eb] bg-[#f9fafb] transition-[width]",
          sidebarCollapsed
            ? "w-0 overflow-hidden border-r-0 opacity-0"
            : "w-[260px] opacity-100",
        ].join(" ")}
        aria-hidden={sidebarCollapsed}
      >
        <div className="flex h-14 items-center gap-2 border-b border-[#eceeef] px-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eef2ff] text-sm font-semibold text-[#4f46e5]">
            FB
          </div>
          <span className="truncate text-[15px] font-semibold tracking-tight text-[#111827]">
            FamBrain
          </span>
        </div>

        <div className="px-3 pt-3 pb-2 text-[13px] text-[#9ca3af]">
          历史对话
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
          {listLoading ? (
            <li className="px-3 py-6 text-center text-[13px] text-[#9ca3af]">
              加载列表中…
            </li>
          ) : listError ? (
            <li className="px-3 py-4 text-[13px] text-red-600">
              <span className="block">{listError}</span>
              <button
                type="button"
                onClick={() => void loadConversations()}
                className="mt-2 text-[13px] font-medium text-[#4f46e5] hover:underline"
              >
                重试
              </button>
            </li>
          ) : conversations.length === 0 ? (
            <li className="px-3 py-6 text-center text-[13px] text-[#9ca3af]">
              暂无历史对话
            </li>
          ) : (
            conversations.map((c) => {
              const selected = activeConversationId === c.id;
              const editing = editingSidebarId === c.id;
              return (
                <li key={c.id} className="group relative">
                  {editing ? (
                    <form
                      className="flex flex-col gap-2 rounded-xl border border-[#e5e7eb] bg-white px-2.5 py-2 shadow-sm"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const t = editSidebarTitleDraft.trim();
                        if (!t) return;
                        void (async () => {
                          const ok = await patchConversation(c.id, {
                            title: t,
                          });
                          if (ok) setEditingSidebarId(null);
                        })();
                      }}
                    >
                      <input
                        value={editSidebarTitleDraft}
                        onChange={(e) =>
                          setEditSidebarTitleDraft(e.target.value)
                        }
                        className="w-full rounded-lg border border-[#e5e7eb] px-2 py-1.5 text-[13px] text-[#111827] outline-none focus:border-[#4f46e5]"
                        autoFocus
                        maxLength={512}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-[12px] text-[#6b7280] hover:bg-[#f3f4f6]"
                          onClick={() => setEditingSidebarId(null)}
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          className="rounded-lg bg-[#4f46e5] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[#4338ca]"
                        >
                          保存
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div
                      className={[
                        "group relative flex items-center gap-0.5 rounded-lg transition-colors",
                        selected ? "bg-[#ececee]" : "hover:bg-black/[0.04]",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSidebarId(null);
                          setPreferEmptySession(false);
                          setActiveConversationId(c.id);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#e8e8ea] bg-white text-[#a1a1aa]">
                          {c.pinned ? (
                            <IconPin
                              active
                              className="h-3.5 w-3.5 text-amber-500"
                            />
                          ) : (
                            <IconChat />
                          )}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-[14px] text-[#374151]"
                          title={
                            c.title !== shortConversationTitle(c.title)
                              ? c.title
                              : undefined
                          }
                        >
                          {shortConversationTitle(c.title)}
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label={c.pinned ? "取消置顶" : "置顶"}
                          title={c.pinned ? "取消置顶" : "置顶"}
                          onClick={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            void togglePinOptimistic(c.id);
                          }}
                          className={[
                            "flex h-7 w-7 items-center justify-center rounded-md hover:bg-black/[0.06]",
                            c.pinned
                              ? "text-amber-500"
                              : "text-[#9ca3af] hover:text-amber-500",
                          ].join(" ")}
                        >
                          <IconPin active={c.pinned} />
                        </button>
                        <button
                          type="button"
                          aria-label="修改标题"
                          title="修改标题"
                          onClick={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            setEditingSidebarId(c.id);
                            setEditSidebarTitleDraft(c.title);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-[#9ca3af] hover:bg-black/[0.06] hover:text-[#4f46e5] pt-3"
                        >
                          <IconEditTitle />
                        </button>
                        <button
                          type="button"
                          aria-label="删除对话"
                          title="删除对话"
                          onClick={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            void deleteConversationOptimistic(c.id, c.title);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-[#9ca3af] hover:bg-red-50 hover:text-red-600"
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>

        <div className="mt-auto border-t border-[#eceeef] p-3">
          <Link
            href="/me"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-[#6b7280] transition-colors hover:bg-black/[0.04] hover:text-[#374151]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e5e7eb] text-xs font-semibold text-[#374151]">
              {(viewer?.displayName ?? "家").slice(0, 1)}
            </div>
            <span className="min-w-0 flex-1 truncate">
              <span className="block truncate font-medium text-[#374151]">
                {viewer?.displayName ?? "家庭成员"}
              </span>
              <span className="block truncate text-[11px] text-[#9ca3af]">
                {(viewer?.isAdmin ? "管理员 · " : "") +
                  (viewer?.canManageMembers ? "成员管理 · " : "")}
                {viewer?.username ? `@${viewer.username}` : "@local"}
              </span>
            </span>
          </Link>
          {viewer?.canManageMembers ? (
            <Link
              href="/admin/users"
              className="mt-2 block rounded-lg px-2 py-1.5 text-center text-[12px] font-medium text-[#4f46e5] hover:bg-[#eef2ff]"
            >
              审核成员
            </Link>
          ) : null}
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col bg-white shadow-[inset_1px_0_0_rgba(0,0,0,0.04)]">
        <header className="relative flex h-14 shrink-0 items-center border-b border-[#f0f0f0] px-4">
          <div className="relative z-10 flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="rounded-lg p-2 text-[#6b7280] hover:bg-black/[0.04] hover:text-[#374151]"
              aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            >
              <IconSidebarToggle />
            </button>
            <button
              type="button"
              onClick={startNewChat}
              className="rounded-lg p-2 text-[#6b7280] hover:bg-black/[0.04]"
              aria-label="新对话"
            >
              <IconPlus />
            </button>
          </div>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-28 sm:px-36">
            <span className="flex max-w-full min-w-0 items-center justify-center gap-1">
              {activeConversation?.pinned ? (
                <span
                  className="pointer-events-auto shrink-0 text-amber-500"
                  title="已置顶"
                >
                  <IconPin active className="inline align-[-3px]" />
                </span>
              ) : null}
              <span
                className="truncate text-center text-[15px] font-semibold text-[#111827]"
                title={
                  activeTitleRaw !== activeTitleShort
                    ? activeTitleRaw
                    : undefined
                }
              >
                {activeTitleShort}
              </span>
              {activeConversationId ? (
                <button
                  type="button"
                  aria-label="修改标题"
                  className="pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#9ca3af] hover:bg-black/[0.06] hover:text-[#4f46e5]"
                  onClick={() => {
                    if (!activeConversationId) return;
                    setEditingSidebarId(activeConversationId);
                    setEditSidebarTitleDraft(activeTitleRaw);
                  }}
                >
                  <IconEditTitle className="pt-0.5" />
                </button>
              ) : null}
            </span>
            <span className="hidden text-[11px] text-[#9ca3af] sm:block">
              内容由 AI 生成，请仔细甄别
            </span>
          </div>

          <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1 text-[#9ca3af]">
            <span className="hidden text-[13px] sm:inline">更多</span>
            <button
              type="button"
              className="rounded-lg p-2 hover:bg-black/[0.04]"
            >
              ⋮
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {sendingFirstOnNewChat ? (
            <div className="flex flex-1 items-center justify-center px-6 pb-[18vh] text-[14px] text-[#9ca3af]">
              正在写入会话并调用模型…
            </div>
          ) : showingEmptyLanding ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 pb-[18vh]">
              <h1 className="text-center text-[26px] font-semibold tracking-tight text-[#111827] sm:text-[30px]">
                有什么我能帮你的吗？
              </h1>
              <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => applySuggestion(s)}
                    className="rounded-2xl border border-[#e5e7eb] bg-[#fafafa] px-4 py-3 text-left text-[14px] leading-snug text-[#374151] transition-colors hover:border-[#d1d5db] hover:bg-white"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : messagesLoading ? (
            <div className="flex flex-1 items-center justify-center text-[14px] text-[#9ca3af]">
              加载消息中…
            </div>
          ) : messagesError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[14px] text-red-600">
              <span>{messagesError}</span>
              <button
                type="button"
                onClick={() => setMessagesRetryTick((n) => n + 1)}
                className="text-[13px] font-medium text-[#4f46e5] hover:underline"
              >
                重试
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 pb-[18vh]">
              <h1 className="text-center text-[26px] font-semibold tracking-tight text-[#111827] sm:text-[30px]">
                有什么我能帮你的吗？
              </h1>
              <p className="mt-2 text-[14px] text-[#9ca3af]">该会话暂无消息</p>
            </div>
          ) : (
            <div
              ref={messagesScrollRef}
              className="flex-1 overflow-y-auto px-4 py-6 sm:px-8"
            >
              <ul className="mx-auto flex max-w-3xl flex-col gap-4">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className={[
                      "flex",
                      m.role === "user" ? "justify-end" : "justify-start",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap",
                        m.role === "user"
                          ? "bg-[#4f46e5] text-white"
                          : "bg-[#f3f4f6] text-[#111827]",
                      ].join(" ")}
                    >
                      {m.content}
                      {m.role === "assistant" && m.timing ? (
                        <MessageTimingLine timing={m.timing} />
                      ) : null}
                    </div>
                  </li>
                ))}
                {showAssistantPending ? <AssistantPendingRow /> : null}
                {sendBusy && thinkingPanelVisible && streamThinking.trim() ? (
                  <li className="flex justify-start">
                    <div className="max-w-[90%] rounded-2xl border border-amber-200/90 bg-amber-50 px-4 py-3 text-[15px] leading-relaxed shadow-sm">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                        思考过程
                      </div>
                      <pre className="mt-2 max-h-[min(40vh,320px)] overflow-y-auto whitespace-pre-wrap text-[13px] text-amber-950/90">
                        {streamThinking}
                      </pre>
                    </div>
                  </li>
                ) : null}
                {streamAnswerPreview ? (
                  <li className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] px-4 py-2.5 text-[15px] leading-relaxed text-[#374151] whitespace-pre-wrap">
                      {streamAnswerPreview}
                    </div>
                  </li>
                ) : null}
              </ul>
            </div>
          )}

          <div className="shrink-0 border-t border-[#f3f4f6] bg-white px-4 pb-6 pt-4 sm:px-8">
            <div className="mx-auto max-w-3xl rounded-[22px] border border-[#e8e8e8] bg-[#fafafa] shadow-sm">
              {sendError ? (
                <div className="border-b border-red-100 px-4 py-2 text-[13px] text-red-600">
                  {sendError}
                </div>
              ) : null}
              {speech.error ? (
                <div className="border-b border-amber-100 px-4 py-2 text-[13px] text-amber-800">
                  {speech.error}
                </div>
              ) : null}
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  speechDraftBaseRef.current = e.target.value;
                  if (sendError) setSendError(null);
                }}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
                disabled={sendBusy}
                placeholder={
                  sendBusy
                    ? "生成回复中…"
                    : speech.listening
                      ? "正在听你说…（说完点红色麦克风停止）"
                      : "发消息或输入 '/' 选择技能（Enter 发送，Shift+Enter 换行；中文选字时 Enter 不会发送）"
                }
                rows={3}
                className="block w-full resize-none bg-transparent px-4 pb-2 pt-3 text-[15px] text-[#111827] outline-none placeholder:text-[#a1a1aa] disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  if (e.nativeEvent.isComposing || isComposingRef.current)
                    return;
                  e.preventDefault();
                  void sendMessage();
                }}
              />
              <div className="flex items-center gap-2 border-t border-black/[0.04] px-3 py-2">
                <button
                  type="button"
                  className="rounded-lg p-2 text-[#9ca3af] hover:bg-black/[0.04] hover:text-[#374151]"
                  aria-label="添加"
                >
                  <IconPlus className="h-5 w-5" />
                </button>
                <div className="flex flex-1 flex-wrap items-center gap-1 text-[13px] text-[#9ca3af]">
                  {["快捷", "编程", "图像", "写作"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="rounded-full px-2.5 py-1 hover:bg-black/[0.04] hover:text-[#4b5563]"
                    >
                      {t}
                    </button>
                  ))}
                  <span className="px-1">…</span>
                </div>
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={!draft.trim() || sendBusy}
                  className="rounded-full bg-[#4f46e5] px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
                >
                  {sendBusy ? "发送中…" : "发送"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!speech.listening) speechDraftBaseRef.current = draft;
                    speech.toggle();
                  }}
                  disabled={sendBusy || !speech.supported}
                  title={
                    speech.supported
                      ? speech.listening
                        ? "点击停止语音输入"
                        : "语音输入（浏览器识别）"
                      : "当前浏览器不支持语音输入"
                  }
                  className={[
                    "rounded-lg p-2 disabled:opacity-40",
                    speech.listening
                      ? "bg-red-50 text-red-600 animate-pulse"
                      : "text-[#9ca3af] hover:bg-black/[0.04] hover:text-[#374151]",
                  ].join(" ")}
                  aria-label={speech.listening ? "停止语音输入" : "语音输入"}
                  aria-pressed={speech.listening}
                >
                  <IconMic />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
