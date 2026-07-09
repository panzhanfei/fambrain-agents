/** 助手消息结构化块（列举型 UI + composite 分段） */

export type EnumerationListKind = "project" | "employer";

export type EnumerationListItem = {
    id: string;
    title: string;
    subtitle?: string;
    path: string;
    excerpt?: string;
};

export type AssistantMessageBlock =
    | { type: "heading"; text: string; sectionNo?: number }
    | { type: "text"; markdown: string }
    | {
          type: "enumeration";
          listKind: EnumerationListKind;
          items: EnumerationListItem[];
          total: number;
          shown: number;
          page: number;
          pageSize: number;
          hasMore: boolean;
          /** 本页首项在全库列表中的序号（分页续问从 9、21… 起） */
          startIndex?: number;
          /** 分页说明（Web 展示，与纯文本 footer 一致） */
          paginationHint?: string;
      }
    | {
          type: "actions";
          actions: Array<{
              id: string;
              label: string;
              prompt: string;
          }>;
      };

export type AssistantMessagePayload = {
    /** 纯文本 fallback（搜索、通知、旧客户端） */
    plainText: string;
    blocks: AssistantMessageBlock[];
};
