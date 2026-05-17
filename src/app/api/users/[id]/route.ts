import { UserStatus } from "@/generated/prisma/client";
import { getAuthSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { forbiddenIfUntrustedMutation } from "@/lib/security/same-origin";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const patchBodySchema = z.object({
  status: z.enum(["ACTIVE", "REJECTED"]),
});

type RouteCtx = { params: Promise<{ id: string }> };

/** 身份证号匹配后缀的账号：审核通过 / 拒绝 */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const untrusted = forbiddenIfUntrustedMutation(req);
  if (untrusted) return untrusted;

  const admin = await getAuthSession();
  if (!admin) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!admin.canManageMembers) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须为 JSON" }, { status: 400 });
  }

  const parsed = patchBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  if (target.id === admin.userId && parsed.data.status === "REJECTED") {
    return NextResponse.json({ error: "无法将自己标记为拒绝" }, { status: 400 });
  }

  const next =
    parsed.data.status === "ACTIVE" ? UserStatus.ACTIVE : UserStatus.REJECTED;

  const updated = await prisma.user.update({
    where: { id },
    data: { status: next },
    select: {
      id: true,
      username: true,
      displayName: true,
      relationToPrincipal: true,
      role: true,
      status: true,
    },
  });

  return NextResponse.json(updated);
}

/** 身份证号匹配后缀的账号：删除某一成员（级联删除其会话） */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const untrusted = forbiddenIfUntrustedMutation(req);
  if (untrusted) return untrusted;

  const actor = await getAuthSession();
  if (!actor) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!actor.canManageMembers) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (id === actor.userId) {
    return NextResponse.json({ error: "不能删除当前登录账号" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
