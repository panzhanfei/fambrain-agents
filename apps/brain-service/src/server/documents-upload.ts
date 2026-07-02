import type { IncomingMessage, ServerResponse } from "node:http";
import { docParserLogger, docUploadFieldSchema, ingestDocumentBatch, } from "@/agentflow/brain-service/offline/doc-parser";
import { requireAuth } from "@/server/auth-middleware";
import { parseMultipartRequest } from "@/server/parse-multipart";
const parseRelativePathsField = (raw: string | undefined): string[] | undefined => {
    if (!raw?.trim())
        return undefined;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed))
            return undefined;
        return parsed.map((item) => String(item));
    }
    catch {
        return undefined;
    }
};
export const handleDocumentsUpload = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "method not allowed" }));
        return;
    }
    const actorUserId = await requireAuth(req, res);
    if (!actorUserId)
        return;
    let multipart;
    try {
        multipart = await parseMultipartRequest(req);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : "invalid multipart body";
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
        return;
    }
    const fieldsParsed = docUploadFieldSchema.safeParse(multipart.fields);
    if (!fieldsParsed.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: fieldsParsed.error.message }));
        return;
    }
    const { corpusUserId: corpusUserIdField, category, indexAfter } = fieldsParsed.data;
    const corpusUserId = corpusUserIdField ?? actorUserId;
    const relativePaths = parseRelativePathsField(fieldsParsed.data.relativePaths);
    if (multipart.files.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "请至少上传 1 个文件（字段名 files）" }));
        return;
    }
    try {
        const result = await ingestDocumentBatch(multipart.files.map((f, index) => ({
            fileName: f.fileName,
            buffer: f.buffer,
            relativePath: relativePaths?.[index],
        })), {
            actorUserId,
            corpusUserId,
            category,
            indexAfter,
            logger: docParserLogger,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
    }
    catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : "文档解析入库失败";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
    }
};
