import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { MemoryCandidateTarget } from "@fambrain/db";
import { promoteLearnedCandidate } from "@/agentflow/agents/offline/learning";
import { requireAuth } from "@/server/auth-middleware";

const readJsonBody = async (req: IncomingMessage, maxBytes = 512000): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > maxBytes) throw new Error("payload too large");
        chunks.push(buf);
    }
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const applyBodySchema = z.object({
    corpusUserId: z.string().min(1),
    factKey: z.string().min(1),
    label: z.string().min(1),
    value: z.string().min(1),
    confidence: z.number().min(0).max(1).default(0.9),
    target: z.enum(["MEM0", "CORPUS_LEARNED", "BOTH"]),
    conversationId: z.string().optional(),
    citations: z.array(z.string()).optional(),
    reindex: z.boolean().optional(),
});

export const handleLearningApply = async (
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> => {
    if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "method not allowed" }));
        return;
    }
    const actorUserId = await requireAuth(req, res);
    if (!actorUserId) return;

    let json: unknown;
    try {
        json = await readJsonBody(req);
    }
    catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid json body" }));
        return;
    }
    const parsed = applyBodySchema.safeParse(json);
    if (!parsed.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: parsed.error.message }));
        return;
    }
    const body = parsed.data;
    try {
        const { learnedPath } = await promoteLearnedCandidate({
            context: {
                actorUserId,
                corpusUserId: body.corpusUserId,
                displayName: "",
                conversationId: body.conversationId ?? "learning-apply",
            },
            candidate: {
                factKey: body.factKey,
                label: body.label,
                value: body.value,
                confidence: body.confidence,
                target:
                    body.target === MemoryCandidateTarget.CORPUS_LEARNED ?
                        "corpus"
                    :   body.target === MemoryCandidateTarget.BOTH ?
                        "both"
                    :   "mem0",
                citations: body.citations,
            },
            target: body.target as MemoryCandidateTarget,
            approvedByUserId: actorUserId,
            reindex: body.reindex ?? true,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, learnedPath: learnedPath ?? null }));
    }
    catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : "learning apply failed";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
    }
};
