"use client";

import type { ConversationListItem } from "@fambrain/db";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type PatchConversationOk = {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
};

function isPatchConversationPayload(v: unknown): v is PatchConversationOk {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.pinned === "boolean" &&
    typeof o.updatedAt === "string"
  );
}

function sortConversationsForSidebar(items: ConversationListItem[]): ConversationListItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

/** 已发出请求、尚未收到首段思考或正文流时 */
function AssistantPendingRow() {
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
}

const SUGGESTIONS = [
  "AI Agent 的核心工作原理是什么？",
  "用通俗语言解释大模型微调",
  "帮我写一份工作周报提纲",
  "推荐几本系统设计的入门资料",
];

function formatListTime(iso: string): string {
  try {
    const date = new Date(iso);
    const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
    const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
    if (diffSec < 60) return "刚刚";
    if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), "minute");
    if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), "hour");
    if (diffSec < 86400 * 7) return rtf.format(-Math.floor(diffSec / 86400), "day");
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date);
  } catch {
    return "";
  }
}

function IconSidebarToggle({ className }: { className?: string }) {
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
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function IconMic({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" strokeLinejoin="round" />
      <path d="M19 11a7 7 0 0 1-14 0" strokeLinecap="round" />
      <path d="M12 19v3" strokeLinecap="round" />
    </svg>
  );
}

/** 侧边栏置顶（星标） */
function IconPin({ active, className }: { active?: boolean; className?: string }) {
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
}

function IconEditTitle({ className }: { className?: string }) {
  return (
    <svg className={className} width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m15.2 6.9 3.9-4L21 3l-.9 2-3.9 4M13 10l8-9-5-5-8 9v5h5Z"
      />
    </svg>
  );
}

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
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
}

async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  handle: (event: string, payload: unknown) => void,
): Promise<void> {
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
          if (ln.startsWith("event:")) eventName = ln.slice("event:".length).trim();
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
}

async function mutateJson<B, R>(
  url: string,
  method: "POST" | "PATCH",
  body: B,
): Promise<{ ok: true; data: R } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
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
      typeof (parsed as { error?: unknown }).error === "string"
    ) {
      msg = (parsed as { error: string }).error;
    }

    if (!res.ok) {
      return { ok: false, error: msg, status: res.status };
    }

    return { ok: true, data: parsed as R };
  } catch {
    return { ok: false, error: "网络错误", status: 0 };
  }
}

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

export function ChatShell({ initialConversations, viewer }: ChatShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [conversations, setConversations] = useState(initialConversations);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [preferEmptySession, setPreferEmptySession] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messagesRetryTick, setMessagesRetryTick] = useState(0);

  const [draft, setDraft] = useState("");
  /** 最近一次发送出错（文案已入库但助手失败时为模型错误提示） */
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);

  const pendingUserTempIdRef = useRef<string | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const [thinkingPanelVisible, setThinkingPanelVisible] = useState(false);
  const [streamThinking, setStreamThinking] = useState("");
  const [streamAnswerPreview, setStreamAnswerPreview] = useState("");
  const [editingSidebarId, setEditingSidebarId] = useState<string | null>(null);
  const [editSidebarTitleDraft, setEditSidebarTitleDraft] = useState("");

  const loadConversations = useCallback(async () => {
    await Promise.resolve();
    setListLoading(true);
    setListError(null);
    const result = await fetchJson<ConversationListItem[]>("/api/conversations");
    setListLoading(false);
    if (result.ok) {
      setConversations(result.data);
    } else {
      setListError(result.error);
      setConversations([]);
    }
  }, []);

  const patchConversation = useCallback(
    async (id: string, body: { title?: string; pinned?: boolean }): Promise<boolean> => {
      const result = await mutateJson<typeof body, unknown>(`/api/conversations/${id}`, "PATCH", body);
      if (!result.ok) {
        setListError(result.error);
        return false;
      }
      await loadConversations();
      return true;
    },
    [loadConversations],
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
          prev.map((c) => (c.id === id ? { ...c, pinned: nextPinned } : c)),
        );
      });
    });

    if (!found) return;

    const result = await mutateJson<{ pinned: boolean }, PatchConversationOk>(
      `/api/conversations/${id}`,
      "PATCH",
      { pinned: nextPinned },
    );

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
            ? { ...c, title: data.title, pinned: data.pinned, updatedAt: data.updatedAt }
            : c,
        ),
      ),
    );
  }, []);

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
        `/api/conversations/${activeConversationId}/messages`,
      );

      if (cancelled) return;
      setMessagesLoading(false);

      if (result.ok) {
        setMessages(result.data);
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

  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;

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
        const created = await mutateJson<Record<string, unknown>, { id: string }>(
          "/api/conversations",
          "POST",
          {},
        );
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

      setMessages((prev) => [...prev, { id: tempUserId, role: "user", content: trimmed }]);

      type MetaPayload = {
        userMessage: ChatMessage;
      };

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
        if (event === "meta" && payload && typeof payload === "object" && payload !== null) {
          const p = payload as MetaPayload;
          if (typeof p.userMessage?.id === "string") {
            pendingUserTempIdRef.current = null;
            const real = p.userMessage;
            setMessages((prev) => prev.map((m) => (m.id === tempUserId ? real : m)));
          }
        }

        if (event === "step" && payload && typeof payload === "object" && payload !== null) {
          const p = payload as { name?: string; status?: string };
          if (p.status === "running" && typeof p.name === "string") {
            const labels: Record<string, string> = {
              intake: "理解问题…",
              retrieval: "检索知识库…",
              analyst: "整理回答…",
            };
            setThinkingPanelVisible(true);
            setStreamThinking(labels[p.name] ?? "处理中…");
          }
        }

        if (event === "thinking" && payload && typeof payload === "object" && payload !== null) {
          const t = (payload as { text?: string }).text;
          if (typeof t === "string" && t.trim()) {
            setThinkingPanelVisible(true);
            setStreamThinking(t);
          }
        }

        if (event === "assistant" && payload && typeof payload === "object" && payload !== null) {
          const t = (payload as { text?: string }).text;
          if (typeof t === "string") {
            setThinkingPanelVisible(false);
            setStreamThinking("");
            setStreamAnswerPreview(t);
          }
        }

        if (event === "done" && payload && typeof payload === "object" && payload !== null) {
          pendingUserTempIdRef.current = null;
          setThinkingPanelVisible(false);
          setStreamThinking("");
          setStreamAnswerPreview("");
        }

        if (event === "error" && payload && typeof payload === "object" && payload !== null) {
          const e = (payload as { error?: string }).error;
          streamFatal = typeof e === "string" ? e : "模型出错";
        }
      });

      if (streamFatal) {
        setSendError(streamFatal);
      }

      await loadConversations();
      setMessagesRetryTick((n) => n + 1);
    } catch {
      setSendError("网络错误");
      pendingUserTempIdRef.current = null;
      setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
      await loadConversations();
      setMessagesRetryTick((n) => n + 1);
    } finally {
      setSendBusy(false);
      setThinkingPanelVisible(false);
      setStreamThinking("");
      setStreamAnswerPreview("");
      pendingUserTempIdRef.current = null;
    }
  }, [activeConversationId, draft, loadConversations, sendBusy]);

  const applySuggestion = (text: string) => {
    setDraft(text);
    setSendError(null);
  };

  const isFreshNewChatUi =
    activeConversationId == null && !messagesLoading && messages.length === 0;

  /** 新开对话且尚未选定会话时的欢迎区 */
  const showingEmptyLanding = isFreshNewChatUi && !sendBusy;
  /** 首条消息已发出、会话尚在创建或模型推理中 */
  const sendingFirstOnNewChat = isFreshNewChatUi && sendBusy;

  return (
    <div className="flex h-dvh bg-[#f3f4f6] text-[#1f2937]">
      <aside
        className={[
          "flex shrink-0 flex-col border-r border-[#e5e7eb] bg-[#f9fafb] transition-[width]",
          sidebarCollapsed ? "w-0 overflow-hidden border-r-0 opacity-0" : "w-[260px] opacity-100",
        ].join(" ")}
        aria-hidden={sidebarCollapsed}
      >
        <div className="flex h-14 items-center gap-2 border-b border-[#eceeef] px-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eef2ff] text-sm font-semibold text-[#4f46e5]">
            FB
          </div>
          <span className="truncate text-[15px] font-semibold tracking-tight text-[#111827]">FamBrain</span>
        </div>

        <div className="px-3 pt-3 pb-1 text-[12px] font-medium uppercase tracking-wide text-[#9ca3af]">
          历史对话
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
          {listLoading ? (
            <li className="px-3 py-6 text-center text-[13px] text-[#9ca3af]">加载列表中…</li>
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
            <li className="px-3 py-6 text-center text-[13px] text-[#9ca3af]">暂无历史对话</li>
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
                          const ok = await patchConversation(c.id, { title: t });
                          if (ok) setEditingSidebarId(null);
                        })();
                      }}
                    >
                      <input
                        value={editSidebarTitleDraft}
                        onChange={(e) => setEditSidebarTitleDraft(e.target.value)}
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
                        "flex items-stretch gap-0.5 rounded-xl transition-colors",
                        selected ? "bg-white shadow-sm ring-1 ring-black/[0.04]" : "hover:bg-black/[0.03]",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSidebarId(null);
                          setPreferEmptySession(false);
                          setActiveConversationId(c.id);
                        }}
                        className="min-w-0 flex-1 px-3 py-2.5 text-left"
                      >
                        <span className="flex items-center gap-1.5">
                          {c.pinned ? (
                            <IconPin
                              active
                              className="shrink-0 text-amber-500"
                            />
                          ) : null}
                          <span className="line-clamp-1 text-[14px] font-medium text-[#111827]">{c.title}</span>
                        </span>
                        <span className="mt-0.5 block line-clamp-1 text-[12px] text-[#9ca3af]">
                          {c.preview || "暂无消息"}
                          <span className="text-[11px] text-[#bdbdbd]">
                            {" "}
                            · {formatListTime(c.updatedAt)}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 flex-col justify-center gap-0.5 pr-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
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
                            "rounded-lg p-1.5 hover:bg-black/[0.06]",
                            c.pinned ? "text-amber-500" : "text-[#9ca3af] hover:text-amber-500",
                          ].join(" ")}
                        >
                          <IconPin active={c.pinned} className="mx-auto" />
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
                          className="rounded-lg p-1.5 text-[#9ca3af] hover:bg-black/[0.06] hover:text-[#4f46e5]"
                        >
                          <IconEditTitle className="mx-auto text-[15px]" />
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
                {(viewer?.isAdmin ? "管理员 · " : "") + (viewer?.canManageMembers ? "成员管理 · " : "")}
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
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#f0f0f0] px-4">
          <div className="flex items-center gap-2">
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
            <div className="ml-1 flex min-w-0 flex-1 flex-col justify-center leading-tight">
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-[15px] font-semibold text-[#111827]">
                  {activeConversation?.pinned ? (
                    <span className="mr-1 inline-block align-middle text-amber-500" title="已置顶">
                      <IconPin active className="inline align-[-3px]" />
                    </span>
                  ) : null}
                  {activeConversation?.title ?? "新对话"}
                </span>
                {activeConversationId ? (
                  <button
                    type="button"
                    aria-label="修改标题"
                    className="shrink-0 rounded-md p-1 text-[#9ca3af] hover:bg-black/[0.06] hover:text-[#4f46e5]"
                    onClick={() => {
                      if (!activeConversationId) return;
                      setEditingSidebarId(activeConversationId);
                      setEditSidebarTitleDraft(activeConversation?.title ?? "");
                    }}
                  >
                    <IconEditTitle />
                  </button>
                ) : null}
              </span>
              <span className="hidden text-[11px] text-[#9ca3af] sm:block">
                内容由 AI 生成，请仔细甄别
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[#9ca3af]">
            <span className="hidden text-[13px] sm:inline">更多</span>
            <button type="button" className="rounded-lg p-2 hover:bg-black/[0.04]">
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
            <div className="flex flex-1 items-center justify-center text-[14px] text-[#9ca3af]">加载消息中…</div>
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
            <div ref={messagesScrollRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
              <ul className="mx-auto flex max-w-3xl flex-col gap-4">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className={["flex", m.role === "user" ? "justify-end" : "justify-start"].join(" ")}
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
                    </div>
                  </li>
                ))}
                {sendBusy && !streamThinking.trim() && !streamAnswerPreview ? <AssistantPendingRow /> : null}
                {thinkingPanelVisible && streamThinking.trim() ? (
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
                {sendBusy && streamAnswerPreview ? (
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
                <div className="border-b border-red-100 px-4 py-2 text-[13px] text-red-600">{sendError}</div>
              ) : null}
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (sendError) setSendError(null);
                }}
                disabled={sendBusy}
                placeholder={
                  sendBusy ? "生成回复中…" : "发消息或输入 '/' 选择技能（Enter 发送，Shift+Enter 换行）"
                }
                rows={3}
                className="block w-full resize-none bg-transparent px-4 pb-2 pt-3 text-[15px] text-[#111827] outline-none placeholder:text-[#a1a1aa] disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
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
                  className="rounded-lg p-2 text-[#9ca3af] hover:bg-black/[0.04]"
                  aria-label="语音"
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
}
