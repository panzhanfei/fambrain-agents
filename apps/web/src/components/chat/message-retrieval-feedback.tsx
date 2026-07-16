"use client";

import { useCallback, useEffect, useState } from "react";

type Props = {
    messageId: string;
    conversationId: string;
    retrievalPaths?: string[];
};

type Signal = 1 | -1;

const storageKey = (messageId: string) =>
    `fambrain:retrieval-feedback:${messageId}`;

const readLocalSignal = (messageId: string): Signal | null => {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(storageKey(messageId));
        if (raw === "1") return 1;
        if (raw === "-1") return -1;
    } catch {
        /* ignore */
    }
    return null;
};

const writeLocalSignal = (messageId: string, signal: Signal) => {
    try {
        window.localStorage.setItem(storageKey(messageId), String(signal));
    } catch {
        /* ignore */
    }
};

export const MessageRetrievalFeedback = ({
    messageId,
    conversationId,
    retrievalPaths,
}: Props) => {
    const [selected, setSelected] = useState<Signal | null>(() =>
        readLocalSignal(messageId)
    );
    const [pending, setPending] = useState(false);

    useEffect(() => {
        const local = readLocalSignal(messageId);
        if (local != null) {
            setSelected(local);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(
                    `/api/retrieval-feedback?messageId=${encodeURIComponent(messageId)}`
                );
                if (!res.ok || cancelled) return;
                const data = (await res.json()) as { signal?: number | null };
                if (data.signal === 1 || data.signal === -1) {
                    writeLocalSignal(messageId, data.signal);
                    if (!cancelled) setSelected(data.signal);
                }
            } catch {
                /* ignore */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [messageId]);

    const send = useCallback(
        async (signal: Signal) => {
            if (selected != null || pending || !retrievalPaths?.length) return;
            setPending(true);
            setSelected(signal);
            writeLocalSignal(messageId, signal);
            try {
                await Promise.all(
                    retrievalPaths.map((repoPath) =>
                        fetch("/api/retrieval-feedback", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                messageId,
                                conversationId,
                                repoPath,
                                signal,
                            }),
                        })
                    )
                );
            } finally {
                setPending(false);
            }
        },
        [conversationId, messageId, pending, retrievalPaths, selected]
    );

    if (!retrievalPaths?.length) return null;

    const locked = selected != null || pending;
    const upActive = selected === 1;
    const downActive = selected === -1;

    return (
        <div className="mt-2 flex items-center gap-2 border-t border-[#e5e7eb] pt-2">
            <span className="text-[11px] text-[#9ca3af]">检索是否有帮助？</span>
            <button
                type="button"
                disabled={locked}
                onClick={() => void send(1)}
                aria-pressed={upActive}
                className={[
                    "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                    upActive
                        ? "bg-emerald-50 font-medium text-[#059669]"
                        : locked
                          ? "cursor-not-allowed text-[#9ca3af]"
                          : "text-[#059669] hover:bg-emerald-50",
                ].join(" ")}
            >
                有帮助
            </button>
            <button
                type="button"
                disabled={locked}
                onClick={() => void send(-1)}
                aria-pressed={downActive}
                className={[
                    "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                    downActive
                        ? "bg-red-50 font-medium text-[#dc2626]"
                        : locked
                          ? "cursor-not-allowed text-[#9ca3af]"
                          : "text-[#dc2626] hover:bg-red-50",
                ].join(" ")}
            >
                无帮助
            </button>
        </div>
    );
};
