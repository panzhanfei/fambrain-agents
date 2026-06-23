export type DocParseCategorySummary = {
    personal: number;
    projects: number;
    experience: number;
};

export type DocUploadFileResult = {
    fileName: string;
    ok: boolean;
    category?: "personal" | "projects" | "experience";
    error?: string;
};

export type DocUploadBatchResult = {
    categorySummary: DocParseCategorySummary;
    indexed: boolean;
    files: DocUploadFileResult[];
};

export const formatDocUploadSummary = (result: DocUploadBatchResult): string => {
    const okCount = result.files.filter((f) => f.ok).length;
    const failedCount = result.files.length - okCount;
    const { personal, projects, experience } = result.categorySummary;
    let msg = `已导入 ${okCount} 个文件：个人 ${personal} · 项目 ${projects} · 经历 ${experience}`;
    if (result.indexed)
        msg += "，向量库已更新";
    if (failedCount > 0)
        msg += `（${failedCount} 个失败）`;
    return msg;
};

const MAX_FILES_PER_REQUEST = 20;

export type UploadDocumentItem = {
    file: File;
    relativePath: string;
};

export type UploadDocumentsOptions = {
    files: UploadDocumentItem[];
    indexAfter?: boolean;
    onProgress?: (done: number, total: number) => void;
};

export type UploadDocumentsOutcome =
    | { ok: true; result: DocUploadBatchResult; summary: string }
    | { ok: false; error: string };

const chunk = <T>(items: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
};

const mergeBatchResults = (parts: DocUploadBatchResult[]): DocUploadBatchResult => {
    const categorySummary = { personal: 0, projects: 0, experience: 0 };
    const files: DocUploadFileResult[] = [];
    let indexed = false;
    for (const part of parts) {
        categorySummary.personal += part.categorySummary.personal;
        categorySummary.projects += part.categorySummary.projects;
        categorySummary.experience += part.categorySummary.experience;
        files.push(...part.files);
        indexed = indexed || part.indexed;
    }
    return { categorySummary, indexed, files };
};

export const uploadDocuments = async (options: UploadDocumentsOptions): Promise<UploadDocumentsOutcome> => {
    const { files, indexAfter = true, onProgress } = options;
    if (files.length === 0) {
        return { ok: false, error: "请选择至少 1 个文件" };
    }
    const batches = chunk(files, MAX_FILES_PER_REQUEST);
    const parts: DocUploadBatchResult[] = [];
    let done = 0;
    for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i];
        const isLast = i === batches.length - 1;
        const formData = new FormData();
        formData.set("indexAfter", isLast && indexAfter ? "true" : "false");
        formData.set("relativePaths", JSON.stringify(batch.map((item) => item.relativePath)));
        for (const item of batch) {
            formData.append("files", item.file, item.file.name);
        }
        const res = await fetch("/api/documents/upload", {
            method: "POST",
            body: formData,
        });
        const payload = (await res.json()) as DocUploadBatchResult & { error?: string };
        if (!res.ok) {
            return { ok: false, error: payload.error ?? `上传失败（HTTP ${res.status}）` };
        }
        parts.push(payload);
        done += batch.length;
        onProgress?.(done, files.length);
    }
    const merged = mergeBatchResults(parts);
    return { ok: true, result: merged, summary: formatDocUploadSummary(merged) };
};

export const filesFromInput = (fileList: FileList | File[]): UploadDocumentItem[] => {
    const files = Array.from(fileList);
    return files.map((file) => ({
        file,
        relativePath: file.webkitRelativePath?.trim() || file.name,
    }));
};
