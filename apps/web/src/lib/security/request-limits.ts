import { NextResponse } from "next/server";

/** Content-Length 快检（超限不落盘读 body），抵御超大 JSON */
export function rejectIfPayloadTooLarge(req: Request, maxBytes: number): Response | null {
  const raw = req.headers.get("content-length");
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > maxBytes) {
    return NextResponse.json({ error: "请求体过大" }, { status: 413 });
  }
  return null;
}
