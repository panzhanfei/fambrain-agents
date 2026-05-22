import { RegisterForm } from "@/components/auth/register-form";
import { prisma } from "@fambrain/db";
import { getAuthSession } from "@fambrain/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function RegisterPage() {
  const session = await getAuthSession();
  if (session?.status === "ACTIVE") redirect("/");
  if (session?.status === "PENDING") redirect("/pending");

  const hintBootstrap = (await prisma.user.count()) === 0;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f3f4f6] px-4 py-12 dark:bg-[#0a0a0a]">
      <div className="w-full max-w-md rounded-2xl border border-[#e5e7eb] bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-[#111827] dark:text-neutral-100">
        <div className="mb-8 text-center">
          <Link href="/" className="text-[18px] font-bold tracking-tight text-[#4f46e5] hover:underline">
            FamBrain
          </Link>
          <p className="mt-2 text-[13px] text-[#6b7280]">注册家庭账号</p>
        </div>
        <RegisterForm hintBootstrap={hintBootstrap} />
      </div>
    </div>
  );
}
