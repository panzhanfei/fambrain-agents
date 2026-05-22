import { getAuthSession } from "@fambrain/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  return NextResponse.json(session);
}
