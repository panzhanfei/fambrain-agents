import { loginUser } from "@fambrain/auth";
import { getRequestIpKey } from "@/lib/security/client-ip";
import { rejectIfPayloadTooLarge } from "@/lib/security/request-limits";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_JSON_BODY = 32_768;

export async function POST(req: Request) {
  const untrusted = forbiddenIfUntrustedMutation(req);
  if (untrusted) return untrusted;

  const oversized = rejectIfPayloadTooLarge(req, MAX_JSON_BODY);
  if (oversized) return oversized;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "用户名或密码无效" }, { status: 400 });
  }

  const result = await loginUser(json, getRequestIpKey(req.headers));

  if (!result.ok) {
    const headers: HeadersInit = {};
    if (result.retryAfterSec) {
      headers["Retry-After"] = String(result.retryAfterSec);
    }
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers }
    );
  }

  return NextResponse.json({ ok: true, redirect: result.redirect });
}
