import type { IncomingMessage, ServerResponse } from "node:http";

import {
  docParserLogger,
  docUploadFieldSchema,
  ingestDocumentBatch,
} from "@/agentflow/agents/offline/doc-parser";
import { requireAuth } from "@/server/auth-middleware";
import { parseMultipartRequest } from "@/server/parse-multipart";

export async function handleDocumentsUpload(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const actorUserId = await requireAuth(req, res);
  if (!actorUserId) return;

  let multipart;
  try {
    multipart = await parseMultipartRequest(req);
  } catch (e) {
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

  const { corpusUserId, category, indexAfter } = fieldsParsed.data;

  if (multipart.files.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "请至少上传 1 个文件（字段名 files）" }));
    return;
  }

  try {
    const result = await ingestDocumentBatch(
      multipart.files.map((f) => ({
        fileName: f.fileName,
        buffer: f.buffer,
      })),
      {
        actorUserId,
        corpusUserId,
        category,
        indexAfter,
        logger: docParserLogger,
      }
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "文档解析入库失败";
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
  }
}
