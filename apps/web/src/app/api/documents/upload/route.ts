import { getAuthSession, getAuthToken } from "@fambrain/auth";
import { resolveAgentsServiceUrl } from "@fambrain/agent-config/service-url";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { resolveCorpusUserId } from "@/server/knowledge/resolve-corpus-user";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
export const POST = async (req: Request) => {
    const untrusted = forbiddenIfUntrustedMutation(req);
    if (untrusted)
        return untrusted;
    const contentLength = req.headers.get("content-length");
    if (contentLength) {
        const n = Number.parseInt(contentLength, 10);
        if (Number.isFinite(n) && n > MAX_UPLOAD_BYTES) {
            return NextResponse.json({ error: "上传总大小超限" }, { status: 413 });
        }
    }
    const session = await getAuthSession();
    if (!session) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (session.status !== "ACTIVE") {
        return NextResponse.json({ error: "账号待审核或未通过审核" }, { status: 403 });
    }
    const authToken = await getAuthToken();
    if (!authToken) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const incoming = await req.formData();
    const corpusUserId = incoming.get("corpusUserId")?.toString().trim() ||
        (await resolveCorpusUserId(session.userId));
    const category = incoming.get("category")?.toString().trim();
    const indexAfter = incoming.get("indexAfter")?.toString() ?? "true";
    const relativePathsRaw = incoming.get("relativePaths")?.toString();
    const outbound = new FormData();
    outbound.set("corpusUserId", corpusUserId);
    if (category)
        outbound.set("category", category);
    outbound.set("indexAfter", indexAfter);
    if (relativePathsRaw)
        outbound.set("relativePaths", relativePathsRaw);
    let fileCount = 0;
    for (const [key, value] of incoming.entries()) {
        if (!(value instanceof File) || value.size === 0)
            continue;
        outbound.append(key, value, value.name);
        fileCount += 1;
    }
    if (fileCount === 0) {
        return NextResponse.json({ error: "请至少上传 1 个文件" }, { status: 400 });
    }
    const baseUrl = resolveAgentsServiceUrl();
    const res = await fetch(`${baseUrl}/documents/upload`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
        body: outbound,
    });
    const text = await res.text();
    let payload: unknown;
    try {
        payload = JSON.parse(text);
    }
    catch {
        payload = { error: text || `Agent 服务失败（HTTP ${res.status}）` };
    }
    return NextResponse.json(payload, { status: res.status });
};
