import { getAuthSession, getAuthToken } from "@fambrain/auth";
import { resolveAgentsServiceUrl } from "@fambrain/agent-config/service-url";
import {
    findPendingMemoryFactForUser,
    MemoryCandidateTarget,
    PendingMemoryFactStatus,
    patchPendingMemoryFactSchema,
    updatePendingMemoryFactStatus,
} from "@fambrain/db";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteCtx = {
    params: Promise<{ id: string }>;
};

export const PATCH = async (req: Request, ctx: RouteCtx) => {
    const untrusted = forbiddenIfUntrustedMutation(req);
    if (untrusted) return untrusted;
    const session = await getAuthSession();
    if (!session) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (session.status !== "ACTIVE") {
        return NextResponse.json({ error: "账号未激活" }, { status: 403 });
    }
    const { id } = await ctx.params;
    let json: unknown;
    try {
        json = await req.json();
    }
    catch {
        return NextResponse.json({ error: "请求体必须为 JSON" }, { status: 400 });
    }
    const parsed = patchPendingMemoryFactSchema.safeParse(json);
    if (!parsed.success) {
        return NextResponse.json({ error: "无效请求" }, { status: 400 });
    }
    const row = await findPendingMemoryFactForUser(session.userId, id);
    if (!row) {
        return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    if (row.status !== PendingMemoryFactStatus.PENDING) {
        return NextResponse.json({ error: "该记录已处理" }, { status: 400 });
    }

    if (parsed.data.action === "reject") {
        const updated = await updatePendingMemoryFactStatus({
            id,
            status: PendingMemoryFactStatus.REJECTED,
            reviewedByUserId: session.userId,
        });
        return NextResponse.json(updated);
    }

    const target = parsed.data.target ?? row.target;
    const authToken = await getAuthToken();
    if (!authToken) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const citations = Array.isArray(row.citations) ?
        (row.citations as string[])
    :   undefined;
    const baseUrl = resolveAgentsServiceUrl();
    const res = await fetch(`${baseUrl}/learning/apply`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            corpusUserId: row.corpusUserId,
            factKey: row.factKey,
            label: row.label,
            value: row.value,
            confidence: row.confidence,
            target,
            conversationId: row.sourceConversationId ?? undefined,
            citations,
            reindex: true,
        }),
    });
    const text = await res.text();
    let payload: { learnedPath?: string | null; error?: string } = {};
    try {
        payload = JSON.parse(text) as typeof payload;
    }
    catch {
        payload = { error: text || `Agent 服务失败（HTTP ${res.status}）` };
    }
    if (!res.ok) {
        return NextResponse.json(
            { error: payload.error ?? "写入失败" },
            { status: res.status }
        );
    }

    const updated = await updatePendingMemoryFactStatus({
        id,
        status:
            target === MemoryCandidateTarget.CORPUS_LEARNED ||
            target === MemoryCandidateTarget.BOTH ?
                PendingMemoryFactStatus.PROMOTED
            :   PendingMemoryFactStatus.APPROVED,
        reviewedByUserId: session.userId,
        learnedPath: payload.learnedPath ?? undefined,
        target,
    });
    return NextResponse.json(updated);
};
