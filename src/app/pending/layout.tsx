import { getAuthSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function PendingLayout({ children }: { children: ReactNode }) {
  const session = await getAuthSession();
  if (!session) redirect("/login");
  if (session.status === "ACTIVE") redirect("/");
  if (session.status === "REJECTED") redirect("/login?reason=rejected");
  return children;
}
