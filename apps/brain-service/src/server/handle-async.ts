import type { IncomingMessage, ServerResponse } from "node:http";
export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
export const handleAsync = (fn: HttpHandler): HttpHandler => {
    return (req, res) => {
        void Promise.resolve(fn(req, res)).catch((err: unknown) => {
            if (res.headersSent) {
                console.error("[@fambrain/brain-service] handler error after headers sent:", err);
                try {
                    res.destroy();
                }
                catch {
                    //
                }
                return;
            }
            console.error(err);
            const msg = err instanceof Error ? err.message : "internal server error";
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: msg }));
        });
    };
};
