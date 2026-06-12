import type { AIMessage } from "@langchain/core/messages";

/** 从 LangChain AIMessage.content 提取纯文本，供 JSON 解析等下游使用。 */
export const textFromResponse = (content: AIMessage["content"]): string => {
    if (typeof content === "string")
        return content.trim();
    if (Array.isArray(content)) {
        return content
            .map((p) => typeof p === "string"
            ? p
            : p &&
                typeof p === "object" &&
                "text" in p &&
                typeof (p as { text: string }).text === "string"
                ? (p as { text: string }).text
                : "")
            .join("")
            .trim();
    }
    return "";
};
