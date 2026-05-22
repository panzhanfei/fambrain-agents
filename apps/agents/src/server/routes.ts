import type { IncomingMessage, ServerResponse } from "node:http";

import { runAgentStream } from "../orchestrator";
import type { AgentStreamEvent } from "@fambrain/agent-types";

import { requireAuth } from "./auth-middleware";
import { pipelineStreamBodySchema } from "./schema";
import { initSseResponse, writeSse } from "./sse";

function streamEventName(ev: AgentStreamEvent): string {
  return ev.type;
}

async function readJsonBody(req: IncomingMessage, maxBytes = 512_000): Promise<unknown> {
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
}

export async function handlePipelineStream(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
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

  const parsed = pipelineStreamBodySchema.safeParse(body);
  if (!parsed.success) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: parsed.error.message }));
    return;
  }

  if (parsed.data.context.actorUserId !== userId) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "无权以该用户身份调用 Agent" }));
    return;
  }

  initSseResponse(res);

  try {
    const gen = runAgentStream(parsed.data.history, parsed.data.context);
    let pipelineResult: { answer: string } | undefined;

    while (true) {
      const next = await gen.next();
      if (next.done) {
        pipelineResult = next.value;
        break;
      }
      writeSse(res, streamEventName(next.value), next.value);
    }

    writeSse(res, "pipeline_done", {
      answer: pipelineResult?.answer ?? "",
    });
  } catch (e) {
    console.error(e);
    const msg =
      e instanceof Error ? e.message : "Agent pipeline failed";
    writeSse(res, "error", { message: msg });
    writeSse(res, "pipeline_done", { answer: "" });
  } finally {
    res.end();
  }
}

export function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "fambrain-agents" }));
}

export function handleNotFound(res: ServerResponse): void {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}
