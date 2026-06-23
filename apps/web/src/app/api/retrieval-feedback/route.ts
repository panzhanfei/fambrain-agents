import { getAuthSession } from "@fambrain/auth";
import { createRetrievalFeedbackSchema, upsertRetrievalFeedback } from "@fambrain/db";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { resolveCorpusUserId } from "@/server/knowledge/resolve-corpus-user";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export const POST = async (req: Request) => {
    const untrusted = forbiddenIfUntrustedMutation(req);
    if (untrusted) return untrusted;
    const session = await getAuthSession();
    if (!session) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (session.status !== "ACTIVE") {
        return NextResponse.json({ error: "账号未激活" }, { status: 403 });
    }
    let json: unknown;
    try {
        json = await req.json();
    }
    catch {
        return NextResponse.json({ error: "请求体必须为 JSON" }, { status: 400 });
    }
    const parsed = createRetrievalFeedbackSchema.safeParse(json);
    if (!parsed.success) {
        return NextResponse.json({ error: "无效请求" }, { status: 400 });
    }
    const corpusUserId =
        parsed.data.corpusUserId ?? (await resolveCorpusUserId(session.userId));
    const row = await upsertRetrievalFeedback({
        userId: session.userId,
        corpusUserId,
        repoPath: parsed.data.repoPath,
        signal: parsed.data.signal,
        conversationId: parsed.data.conversationId,
        messageId: parsed.data.messageId,
        query: parsed.data.query,
    });
    return NextResponse.json(row);
};
