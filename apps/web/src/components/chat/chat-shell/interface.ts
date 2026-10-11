import type { ConversationListItem } from "@fambrain/db";
import type {
  AssistantMessageBlock,
  Citation,
  PipelineTiming,
} from "@fambrain/brain-types";
import type { ChatActionPayload } from "@/lib/chat/action-lifecycle";
import type { ConversationLogBundle } from "@/lib/chat/conversation-logs";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";

export type { ConversationListItem };

export type MessageTiming = PipelineTiming & {
  clientTotalMs?: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** ISO；用于 actions 30min TTL */
  createdAt?: string;
  timing?: MessageTiming;
  retrievalPaths?: string[];
  blocks?: AssistantMessageBlock[];
  citations?: Citation[];
  taskPaused?: boolean;
  pauseKind?: "vault_wait";
  fileJobId?: string;
};

export type PatchConversationOk = {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
};

export type VaultEditorModalState = {
  path: string;
  prompt: string;
  sourceMessageId?: string;
  text: string;
  error: string | null;
  loading: boolean;
};

export type VaultSaveNameModalState = {
  /** save：写回闸门；file / folder：工作台新建，确认后才落盘 */
  purpose: "save" | "file" | "folder";
  prompt: string;
  displayText: string;
  sourceMessageId?: string;
  name: string;
  error: string | null;
};

export type PendingAttachment = {
  id: string;
  file: File;
  name: string;
  size: number;
};

export type ChatShellViewer = {
  displayName: string;
  username: string;
  /** 是否为系统里的 ADMIN 角色（首个注册.bootstrap） */
  isAdmin: boolean;
  /** 身份证号匹配后缀时：可审核 / 删除成员 */
  canManageMembers: boolean;
};

export type ChatShellProps = {
  initialConversations: ConversationListItem[];
  viewer?: ChatShellViewer;
};

export type SpeechInputApi = {
  listening: boolean;
  supported: boolean;
  error: string | null;
  toggle: () => void;
};

export type ChatShellModel = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  listLoading: boolean;
  listError: string | null;
  conversations: ConversationListItem[];
  loadConversations: (opts?: { silent?: boolean }) => Promise<void>;
  activeConversationId: string | null;
  setActiveConversationId: Dispatch<SetStateAction<string | null>>;
  editingSidebarId: string | null;
  setEditingSidebarId: Dispatch<SetStateAction<string | null>>;
  editSidebarTitleDraft: string;
  setEditSidebarTitleDraft: Dispatch<SetStateAction<string>>;
  patchConversation: (
    id: string,
    body: { title?: string; pinned?: boolean }
  ) => Promise<boolean>;
  setPreferEmptySession: Dispatch<SetStateAction<boolean>>;
  setStaleActionKeys: Dispatch<SetStateAction<Set<string>>>;
  setStreamThinking: Dispatch<SetStateAction<string>>;
  setStreamAnswerPreview: Dispatch<SetStateAction<string>>;
  setStreamBlocks: Dispatch<SetStateAction<AssistantMessageBlock[]>>;
  togglePinOptimistic: (id: string) => Promise<void>;
  deleteConversationOptimistic: (id: string, title: string) => Promise<void>;
  viewer?: ChatShellViewer;
  startNewChat: () => void;
  activeConversation: ConversationListItem | null;
  activeTitleRaw: string;
  activeTitleShort: string;
  logPanelOpen: boolean;
  setLogPanelOpen: Dispatch<SetStateAction<boolean>>;
  activeLogBundle: ConversationLogBundle | null;
  streamingTurnId: string | null;
  sendingFirstOnNewChat: boolean;
  showingEmptyLanding: boolean;
  applySuggestion: (text: string) => void;
  messagesLoading: boolean;
  messages: ChatMessage[];
  messagesError: string | null;
  setMessagesRetryTick: Dispatch<SetStateAction<number>>;
  messagesScrollRef: RefObject<HTMLDivElement | null>;
  handleChatAction: (payload: ChatActionPayload) => void;
  vaultSaveNameModal: VaultSaveNameModalState | null;
  setVaultSaveNameDraft: (name: string) => void;
  closeVaultSaveNameModal: () => void;
  confirmVaultSaveName: () => void;
  vaultEditor: VaultEditorModalState | null;
  setVaultEditorText: (text: string) => void;
  closeVaultEditor: () => void;
  confirmVaultEditor: () => void;
  staleActionKeys: Set<string>;
  turnInFlight: boolean;
  hasLiveStreamUi: boolean;
  latestAssistantMessageId: string | null;
  editingMessageId: string | null;
  editDraft: string;
  setEditDraft: Dispatch<SetStateAction<string>>;
  cancelEditUserMessage: () => void;
  commitEditUserMessage: () => Promise<void>;
  sendBusy: boolean;
  canEditUserMessage: (m: ChatMessage) => boolean;
  beginEditUserMessage: (m: ChatMessage) => void;
  thinkingPanelVisible: boolean;
  streamThinking: string;
  streamAnswerPreview: string;
  streamBlocks: AssistantMessageBlock[];
  sendError: string | null;
  uploadNotice: string | null;
  speech: SpeechInputApi;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  speechDraftBaseRef: MutableRefObject<string>;
  setSendError: Dispatch<SetStateAction<string | null>>;
  isComposingRef: MutableRefObject<boolean>;
  pendingAttachments: PendingAttachment[];
  sendMessage: () => Promise<void>;
  uploadBusy: boolean;
  removePendingAttachment: (id: string) => void;
  attachInputRef: RefObject<HTMLInputElement | null>;
  handleAttachPick: (files: FileList | null) => void;
  pauseActiveTurn: () => Promise<void>;
  showAssistantPending: boolean;
};
