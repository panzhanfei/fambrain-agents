"use client";

import type { ConversationListItem } from "@/lib/get-sidebar-conversations";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

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

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url);
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
  }, [activeConversationId, messagesRetryTick]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;

  const startNewChat = useCallback(() => {
    setPreferEmptySession(true);
    setActiveConversationId(null);
    setMessages([]);
    setMessagesError(null);
    setDraft("");
  }, []);

  const sendMessage = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
  }, [draft]);

  const applySuggestion = (text: string) => {
    setDraft(text);
  };

  const showingEmptyLanding = activeConversationId == null && !messagesLoading && messages.length === 0;

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
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPreferEmptySession(false);
                      setActiveConversationId(c.id);
                    }}
                    className={[
                      "flex w-full flex-col rounded-xl px-3 py-2.5 text-left transition-colors",
                      selected ? "bg-white shadow-sm ring-1 ring-black/[0.04]" : "hover:bg-black/[0.03]",
                    ].join(" ")}
                  >
                    <span className="line-clamp-1 text-[14px] font-medium text-[#111827]">{c.title}</span>
                    <span className="mt-0.5 line-clamp-1 text-[12px] text-[#9ca3af]">
                      {c.preview || "暂无消息"}
                      <span className="text-[11px] text-[#bdbdbd]"> · {formatListTime(c.updatedAt)}</span>
                    </span>
                  </button>
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
            <div className="ml-1 flex flex-col justify-center leading-tight">
              <span className="text-[15px] font-semibold text-[#111827]">
                {activeConversation?.title ?? "新对话"}
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
          {showingEmptyLanding ? (
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
            <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
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
              </ul>
            </div>
          )}

          <div className="shrink-0 border-t border-[#f3f4f6] bg-white px-4 pb-6 pt-4 sm:px-8">
            <div className="mx-auto max-w-3xl rounded-[22px] border border-[#e8e8e8] bg-[#fafafa] shadow-sm">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="发消息或输入 '/' 选择技能"
                rows={3}
                className="block w-full resize-none bg-transparent px-4 pb-2 pt-3 text-[15px] text-[#111827] outline-none placeholder:text-[#a1a1aa]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
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
                  onClick={sendMessage}
                  disabled={!draft.trim()}
                  className="rounded-full bg-[#4f46e5] px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
                >
                  发送
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
