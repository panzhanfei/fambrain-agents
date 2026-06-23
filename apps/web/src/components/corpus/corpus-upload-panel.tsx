"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type InputHTMLAttributes } from "react";
import {
    filesFromInput,
    uploadDocuments,
    type UploadDocumentItem,
} from "@/lib/documents/upload-documents";

export const CorpusUploadPanel = () => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [summary, setSummary] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);

    const runUpload = useCallback(async (items: UploadDocumentItem[]) => {
        setBusy(true);
        setError(null);
        setSummary(null);
        setProgress({ done: 0, total: items.length });
        const outcome = await uploadDocuments({
            files: items,
            onProgress: (done, total) => setProgress({ done, total }),
        });
        setBusy(false);
        setProgress(null);
        if (!outcome.ok) {
            setError(outcome.error);
            return;
        }
        setSummary(outcome.summary);
        const failed = outcome.result.files.filter((f) => !f.ok);
        if (failed.length > 0) {
            setError(failed.map((f) => `${f.fileName}: ${f.error ?? "失败"}`).join("\n"));
        }
    }, []);

    const onPickFiles = async (fileList: FileList | null) => {
        if (!fileList?.length || busy)
            return;
        await runUpload(filesFromInput(fileList));
    };

    return (
        <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-10">
            <header>
                <h1 className="text-xl font-semibold text-[#111827]">语料导入</h1>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6b7280]">
                    上传 PDF、Word、PPT 或图片，系统会自动整理进知识库并更新检索索引。无需选择分类或填写用户 ID。
                </p>
            </header>

            <div
                className={[
                    "rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                    dragOver ? "border-[#4f46e5] bg-[#eef2ff]" : "border-[#e5e7eb] bg-white",
                ].join(" ")}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void onPickFiles(e.dataTransfer.files);
                }}
            >
                <p className="text-[15px] font-medium text-[#374151]">拖放文件到此处</p>
                <p className="mt-1 text-[13px] text-[#9ca3af]">或选择单个文件 / 整个文件夹</p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-full bg-[#4f46e5] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#4338ca] disabled:opacity-50"
                    >
                        选择文件
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => folderInputRef.current?.click()}
                        className="rounded-full border border-[#e5e7eb] px-4 py-2 text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb] disabled:opacity-50"
                    >
                        选择文件夹
                    </button>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.tif"
                    onChange={(e) => {
                        void onPickFiles(e.target.files);
                        e.target.value = "";
                    }}
                />
                <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    {...({ webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>)}
                    onChange={(e) => {
                        void onPickFiles(e.target.files);
                        e.target.value = "";
                    }}
                />
            </div>

            {busy && progress ? (
                <p className="text-center text-[13px] text-[#6b7280]">
                    正在导入 {progress.done}/{progress.total}…
                </p>
            ) : null}

            {summary ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] text-emerald-900">
                    {summary}
                </div>
            ) : null}

            {error ? (
                <pre className="whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
                    {error}
                </pre>
            ) : null}

            <nav>
                <Link
                    href="/"
                    className="inline-flex rounded-full border border-[#e5e7eb] px-4 py-2 text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb]"
                >
                    返回对话
                </Link>
            </nav>
        </div>
    );
};
