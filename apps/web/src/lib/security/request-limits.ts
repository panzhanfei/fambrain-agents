import { NextResponse } from "next/server";
export const rejectIfPayloadTooLarge = (req: Request, maxBytes: number): Response | null => {
    const raw = req.headers.get("content-length");
    if (!raw)
        return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0)
        return null;
    if (n > maxBytes) {
        return NextResponse.json({ error: "请求体过大" }, { status: 413 });
    }
    return null;
};
