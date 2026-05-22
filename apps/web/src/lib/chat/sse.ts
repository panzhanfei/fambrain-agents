/**
 * 将 Orchestrator 事件编码为 SSE 帧（供 Route 写入 Response body）。
 */
export function encodeSseEvent(event: string, payload: unknown): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  );
}

export function sseResponse(
  stream: ReadableStream<Uint8Array>
): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
