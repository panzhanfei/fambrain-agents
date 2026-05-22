import type { IncomingMessage, ServerResponse } from "node:http";

import { verifyAuthToken } from "@fambrain/auth/jwt";

function readBearerToken(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) return null;
  const token = raw.slice(7).trim();
  return token || null;
}

/** 校验 Authorization: Bearer JWT，成功返回 userId，失败写 401 并返回 null。 */
export async function requireAuth(
  req: IncomingMessage,
  res: ServerResponse
): Promise<string | null> {
  const token = readBearerToken(req);
  if (!token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "未登录或缺少 Authorization" }));
    return null;
  }

  try {
    return await verifyAuthToken(token);
  } catch {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "登录已失效" }));
    return null;
  }
}
