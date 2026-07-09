import { getAuthSession, getAuthToken } from "@fambrain/auth";
import { resolveBrainServiceUrl } from "@fambrain/brain-config/service-url";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { resolveCorpusUserId } from "@/server/knowledge/resolve-corpus-user";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** POST /api/corpus/enumeration — BFF 代理 brain-service 列举分页 */
export const POST = async (req: Request) => {
    const untrusted = forbiddenIfUntrustedMutation(req);
    if (untrusted) return untrusted;

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

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }

    const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const corpusUserId =
        typeof raw.corpusUserId === "string" && raw.corpusUserId.trim()
            ? raw.corpusUserId.trim()
            : await resolveCorpusUserId(session.userId);

    const baseUrl = resolveBrainServiceUrl();
    const res = await fetch(`${baseUrl}/enumeration/list`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
            ...raw,
            corpusUserId,
        }),
    });

    const text = await res.text();
    try {
        return NextResponse.json(JSON.parse(text), { status: res.status });
    } catch {
        return new NextResponse(text, { status: res.status });
    }
};
