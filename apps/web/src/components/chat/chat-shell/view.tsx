"use client";

import { ConversationLogPanel } from "@/components/chat/conversation-log-panel";
import { ChatComposer } from "./composer";
import { useChatShell } from "./hook";
import { IconEditTitle, IconPin, IconPlus, IconSidebarToggle } from "./icons";
import type { ChatShellProps } from "./interface";
import { ChatSidebar } from "./sidebar";
import { ChatThread } from "./thread";

export const ChatShell = (props: ChatShellProps) => {
  const model = useChatShell(props);
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    startNewChat,
    activeConversation,
    activeTitleRaw,
    activeTitleShort,
    activeConversationId,
    setEditingSidebarId,
    setEditSidebarTitleDraft,
    logPanelOpen,
    setLogPanelOpen,
    activeLogBundle,
    streamingTurnId,
  } = model;

  return (
    <div className="flex h-dvh bg-[#f3f4f6] text-[#1f2937]">
      <ChatSidebar model={model} />
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
            <button
              type="button"
              onClick={() => setLogPanelOpen((v) => !v)}
              disabled={!activeConversationId}
              className={[
                "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-40",
                logPanelOpen
                  ? "bg-[#eef2ff] text-[#4f46e5]"
                  : "text-[#6b7280] hover:bg-black/[0.04] hover:text-[#374151]",
              ].join(" ")}
              title="查看当前对话运行日志"
            >
              日志
            </button>
          </div>
        </header>

        <ConversationLogPanel
          open={logPanelOpen && activeConversationId != null}
          onClose={() => setLogPanelOpen(false)}
          conversationTitle={activeTitleRaw}
          bundle={activeLogBundle}
          liveTurnId={streamingTurnId}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatThread model={model} />
          <ChatComposer model={model} />
        </div>
        {model.vaultSaveNameModal ? (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vault-save-name-title"
          >
            <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
              <h2
                id="vault-save-name-title"
                className="text-[15px] font-semibold text-[#111827]"
              >
                {model.vaultSaveNameModal.purpose === "file"
                  ? "新建 txt"
                  : model.vaultSaveNameModal.purpose === "folder"
                    ? "新建文件夹"
                    : "写入原文库"}
              </h2>
              <p className="mt-1 text-[13px] text-[#6b7280]">
                {model.vaultSaveNameModal.purpose === "folder"
                  ? "确定后在当前目录新建文件夹。"
                  : model.vaultSaveNameModal.purpose === "file"
                    ? "确定后保存为 .txt。"
                    : "文件会保存为 .txt。关闭弹窗不会写入。"}
              </p>
              <label className="mt-3 block text-[12px] text-[#6b7280]">
                {model.vaultSaveNameModal.purpose === "folder"
                  ? "文件夹名"
                  : "文件名"}
                <input
                  autoFocus
                  value={model.vaultSaveNameModal.name}
                  onChange={(e) => model.setVaultSaveNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      model.confirmVaultSaveName();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      model.closeVaultSaveNameModal();
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-[14px] text-[#111827] outline-none focus:border-[#818cf8]"
                  placeholder={
                    model.vaultSaveNameModal.purpose === "folder"
                      ? "例如 notes"
                      : "例如 备忘"
                  }
                />
              </label>
              {model.vaultSaveNameModal.error ? (
                <p className="mt-2 text-[12px] text-red-600">
                  {model.vaultSaveNameModal.error}
                </p>
              ) : null}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={model.closeVaultSaveNameModal}
                  className="rounded-full px-3 py-1.5 text-[13px] text-[#6b7280] hover:bg-[#f3f4f6]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={model.confirmVaultSaveName}
                  className="rounded-full bg-[#4f46e5] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#4338ca]"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {model.vaultEditor ? (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vault-editor-title"
          >
            <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white p-4 shadow-xl">
              <h2
                id="vault-editor-title"
                className="text-[15px] font-semibold text-[#111827]"
              >
                编辑 {model.vaultEditor.path}
              </h2>
              <p className="mt-1 text-[13px] text-[#6b7280]">
                保存后写回原文库，工作台仍停在这一条。
              </p>
              <textarea
                autoFocus
                value={model.vaultEditor.text}
                disabled={model.vaultEditor.loading}
                onChange={(e) => model.setVaultEditorText(e.target.value)}
                className="mt-3 min-h-40 w-full flex-1 resize-y rounded-lg border border-[#e5e7eb] px-3 py-2 text-[14px] leading-relaxed text-[#111827] outline-none focus:border-[#818cf8] disabled:bg-[#f9fafb]"
                placeholder={model.vaultEditor.loading ? "正在读取…" : "在这里写正文"}
              />
              {model.vaultEditor.error ? (
                <p className="mt-2 text-[12px] text-red-600">
                  {model.vaultEditor.error}
                </p>
              ) : null}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={model.closeVaultEditor}
                  className="rounded-full px-3 py-1.5 text-[13px] text-[#6b7280] hover:bg-[#f3f4f6]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={model.confirmVaultEditor}
                  disabled={model.vaultEditor.loading}
                  className="rounded-full bg-[#4f46e5] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#4338ca] disabled:opacity-40"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
};
