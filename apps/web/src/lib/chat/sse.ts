export const encodeSseEvent = (event: string, payload: unknown): Uint8Array => {
    const encoder = new TextEncoder();
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
};
export const sseResponse = (stream: ReadableStream<Uint8Array>): Response => {
    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
};
