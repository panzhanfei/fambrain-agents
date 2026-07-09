"use client";

import type { AssistantMessageBlock } from "@fambrain/brain-types";

type EnumerationBlockProps = {
  block: Extract<AssistantMessageBlock, { type: "enumeration" }>;
  onAction?: (prompt: string) => void;
};

export const EnumerationBlockView = ({
  block,
}: EnumerationBlockProps) => {
  const startIndex =
    block.startIndex ?? (block.page - 1) * block.pageSize + 1;
  return (
    <div className="mt-2 space-y-2">
      <div className="overflow-x-auto rounded-lg border border-[#e5e7eb]">
        <table className="min-w-full text-left text-[13px]">
          <thead className="bg-[#f9fafb] text-[#6b7280]">
            <tr>
              <th className="w-10 px-2 py-2 font-medium text-center">#</th>
              <th className="px-3 py-2 font-medium">项目名称</th>
            </tr>
          </thead>
          <tbody>
            {block.items.map((item, idx) => (
              <tr
                key={item.id}
                className="border-t border-[#f3f4f6] align-top"
              >
                <td className="px-2 py-2 text-center text-[#6b7280] tabular-nums">
                  {startIndex + idx}
                </td>
                <td className="px-3 py-2 font-medium text-[#111827]">
                  {item.title}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.paginationHint ? (
        <p className="text-[12px] leading-relaxed text-[#6b7280]">
          {block.paginationHint}
        </p>
      ) : null}
    </div>
  );
};

type AssistantMessageContentProps = {
  content: string;
  blocks?: AssistantMessageBlock[];
  onAction?: (prompt: string) => void;
};

export const AssistantMessageContent = ({
  content,
  blocks,
  onAction,
}: AssistantMessageContentProps) => {
  if (!blocks?.length) {
    return <>{content}</>;
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          return (
            <div
              key={`h-${i}`}
              className="text-[15px] font-semibold text-[#111827]"
            >
              {block.sectionNo != null
                ? `${block.sectionNo}. ${block.text}`
                : block.text}
            </div>
          );
        }
        if (block.type === "text") {
          return (
            <p key={`t-${i}`} className="whitespace-pre-wrap text-[15px]">
              {block.markdown}
            </p>
          );
        }
        if (block.type === "enumeration") {
          return (
            <EnumerationBlockView
              key={`e-${i}`}
              block={block}
              onAction={onAction}
            />
          );
        }
        if (block.type === "actions") {
          return (
            <div key={`a-${i}`} className="flex flex-wrap gap-2">
              {block.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => onAction?.(action.prompt)}
                  className="rounded-full border border-[#c7d2fe] bg-[#eef2ff] px-3 py-1 text-[12px] font-medium text-[#4338ca] hover:bg-[#e0e7ff]"
                >
                  {action.label}
                </button>
              ))}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
};
