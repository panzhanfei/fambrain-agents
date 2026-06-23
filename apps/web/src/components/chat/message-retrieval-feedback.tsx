"use client";

type Props = {
    messageId: string;
    conversationId: string;
    retrievalPaths?: string[];
};

export const MessageRetrievalFeedback = ({
    messageId,
    conversationId,
    retrievalPaths,
}: Props) => {
    if (!retrievalPaths?.length) return null;

    const send = async (signal: 1 | -1) => {
        for (const repoPath of retrievalPaths) {
            await fetch("/api/retrieval-feedback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messageId,
                    conversationId,
                    repoPath,
                    signal,
                }),
            });
        }
    };

    return (
        <div className="mt-2 flex items-center gap-2 border-t border-[#e5e7eb] pt-2">
            <span className="text-[11px] text-[#9ca3af]">检索是否有帮助？</span>
            <button
                type="button"
                onClick={() => void send(1)}
                className="rounded-md px-2 py-0.5 text-[11px] text-[#059669] hover:bg-emerald-50"
            >
                有帮助
            </button>
            <button
                type="button"
                onClick={() => void send(-1)}
                className="rounded-md px-2 py-0.5 text-[11px] text-[#dc2626] hover:bg-red-50"
            >
                无帮助
            </button>
        </div>
    );
};
