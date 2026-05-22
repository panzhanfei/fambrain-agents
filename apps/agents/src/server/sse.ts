/** SSE 帧编码（Agent 服务 → Web BFF） */
export function encodeSseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function writeSse(res: import("node:http").ServerResponse, event: string, payload: unknown): void {
  res.write(encodeSseEvent(event, payload));
}

export function initSseResponse(res: import("node:http").ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
}
