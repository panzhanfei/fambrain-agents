"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type PendingFact = {
    id: string;
    factKey: string;
    label: string;
    value: string;
    confidence: number;
    target: "MEM0" | "CORPUS_LEARNED" | "BOTH";
    sourceUserQuestion: string | null;
    createdAt: string;
};

type LearnedDoc = {
    path: string;
    title: string;
    preview: string;
    updatedAt: string | null;
};

const targetLabel = (t: PendingFact["target"]) => {
    if (t === "CORPUS_LEARNED") return "语料库";
    if (t === "BOTH") return "记忆 + 语料";
    return "记忆";
};

export const LearningPanel = () => {
    const [pending, setPending] = useState<PendingFact[]>([]);
    const [learned, setLearned] = useState<LearnedDoc[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setError(null);
        const [pRes, lRes] = await Promise.all([
            fetch("/api/pending-memory-facts"),
            fetch("/api/learning/learned"),
        ]);
        if (!pRes.ok) {
            setError("加载待确认记录失败");
            return;
        }
        const pJson = (await pRes.json()) as { items: PendingFact[] };
        setPending(pJson.items ?? []);
        if (lRes.ok) {
            const lJson = (await lRes.json()) as { items: LearnedDoc[] };
            setLearned(lJson.items ?? []);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const act = async (id: string, action: "approve" | "reject") => {
        setBusyId(id);
        setError(null);
        const res = await fetch(`/api/pending-memory-facts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
        });
        setBusyId(null);
        if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            setError(j.error ?? "操作失败");
            return;
        }
        await reload();
    };

    return (
        <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-6 py-10">
            <header>
                <h1 className="text-xl font-semibold text-[#111827]">自主学习</h1>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6b7280]">
                    对话中抽取的候选事实会先进入待确认；批准后写入 Mem0 或{" "}
                    <code className="text-[12px]">corpus/learned/</code> 目录。
                </p>
                <Link
                    href="/"
                    className="mt-3 inline-block text-[13px] font-medium text-[#4f46e5] hover:underline"
                >
                    返回对话
                </Link>
            </header>

            {error ? (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                    {error}
                </div>
            ) : null}

            <section>
                <h2 className="text-[15px] font-semibold text-[#374151]">
                    待确认（{pending.length}）
                </h2>
                {pending.length === 0 ? (
                    <p className="mt-2 text-[13px] text-[#9ca3af]">暂无待确认记录</p>
                ) : (
                    <ul className="mt-3 flex flex-col gap-3">
                        {pending.map((row) => (
                            <li
                                key={row.id}
                                className="rounded-xl border border-[#e5e7eb] bg-white px-4 py-3"
                            >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <p className="text-[14px] font-medium text-[#111827]">
                                            {row.label}：{row.value}
                                        </p>
                                        <p className="mt-1 text-[12px] text-[#6b7280]">
                                            目标 {targetLabel(row.target)} · 置信{" "}
                                            {Math.round(row.confidence * 100)}% ·{" "}
                                            {row.factKey}
                                        </p>
                                        {row.sourceUserQuestion ? (
                                            <p className="mt-1 text-[12px] text-[#9ca3af]">
                                                来源：{row.sourceUserQuestion.slice(0, 120)}
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        <button
                                            type="button"
                                            disabled={busyId === row.id}
                                            onClick={() => void act(row.id, "approve")}
                                            className="rounded-full bg-[#4f46e5] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#4338ca] disabled:opacity-50"
                                        >
                                            批准
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busyId === row.id}
                                            onClick={() => void act(row.id, "reject")}
                                            className="rounded-full border border-[#e5e7eb] px-3 py-1.5 text-[12px] text-[#374151] hover:bg-[#f9fafb] disabled:opacity-50"
                                        >
                                            拒绝
                                        </button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <h2 className="text-[15px] font-semibold text-[#374151]">
                    已学习文档（{learned.length}）
                </h2>
                <p className="mt-1 text-[12px] text-[#9ca3af]">
                    位于语料库 <code>corpus/learned/</code>，已参与检索与引用。
                </p>
                {learned.length === 0 ? (
                    <p className="mt-2 text-[13px] text-[#9ca3af]">尚无学习文档</p>
                ) : (
                    <ul className="mt-3 flex flex-col gap-3">
                        {learned.map((doc) => (
                            <li
                                key={doc.path}
                                className="rounded-xl border border-[#e5e7eb] bg-[#fafafa] px-4 py-3"
                            >
                                <p className="text-[14px] font-medium text-[#111827]">
                                    {doc.title}
                                </p>
                                <p className="mt-1 font-mono text-[11px] text-[#6b7280]">
                                    {doc.path}
                                </p>
                                {doc.preview ? (
                                    <p className="mt-2 line-clamp-3 text-[13px] text-[#374151]">
                                        {doc.preview}
                                    </p>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
};
