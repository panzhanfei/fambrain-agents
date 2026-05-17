import { getAuthSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

/** 已通过审核的成员可访问的对话与资料区 */
export default async function ActiveMemberLayout({ children }: { children: ReactNode }) {
  const session = await getAuthSession();
  if (!session) redirect("/login");
  if (session.status === "REJECTED") {
    redirect("/login?reason=rejected");
  }
  if (session.status === "PENDING") {
    redirect("/pending");
  }
  return children;
}
