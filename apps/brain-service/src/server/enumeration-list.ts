import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { listCorpusEntriesPage, corpusEntryToHit } from "@/agentflow/agents/online/corpus-lister";
import { requireAuth } from "@/server/auth-middleware";

const enumerationListBodySchema = z.object({
    corpusUserId: z.string().min(1),
    listKind: z.enum(["project", "experience"]),
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const readJsonBody = async (
    req: IncomingMessage,
    maxBytes = 65536
): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > maxBytes) {
            throw new Error("payload too large");
        }
        chunks.push(buf);
    }
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

/** POST /enumeration/list — 语料项目/经历分页列表（确定性，不经 hybrid KM） */
export const handleEnumerationList = async (
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> => {
    if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "method not allowed" }));
        return;
    }
    const userId = await requireAuth(req, res);
    if (!userId) return;

    let body: unknown;
    try {
        body = await readJsonBody(req);
    } catch (e) {
        const msg = e instanceof Error ? e.message : "invalid body";
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
        return;
    }

    const parsed = enumerationListBodySchema.safeParse(body);
    if (!parsed.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: parsed.error.message }));
        return;
    }

    try {
        const pageResult = await listCorpusEntriesPage(parsed.data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                listKind: parsed.data.listKind,
                page: pageResult.page,
                pageSize: pageResult.pageSize,
                total: pageResult.total,
                hasMore: pageResult.hasMore,
                items: pageResult.items.map((entry) => ({
                    ...corpusEntryToHit(entry),
                    title: entry.title,
                })),
            })
        );
    } catch (e) {
        const msg = e instanceof Error ? e.message : "列举分页失败";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
    }
};
