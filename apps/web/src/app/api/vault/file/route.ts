import { getAuthSession } from "@fambrain/auth";
import { readWorkspaceFile } from "@/server/vault";
import { resolveCorpusUserId } from "@/server/knowledge";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** GET /api/vault/file?path= — 读取原文库 txt，供编辑弹窗使用。 */
export const GET = async (req: Request) => {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (session.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "账号待审核或未通过审核" },
      { status: 403 }
    );
  }
  const rel = new URL(req.url).searchParams.get("path")?.trim() ?? "";
  if (!rel) {
    return NextResponse.json({ error: "缺少路径" }, { status: 400 });
  }
  const corpusUserId = await resolveCorpusUserId(session.userId);
  const result = readWorkspaceFile(corpusUserId, rel);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ path: rel, text: result.text });
};
