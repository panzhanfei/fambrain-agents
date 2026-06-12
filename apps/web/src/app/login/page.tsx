import { LoginForm } from "@/components/auth/login-form";
import { getAuthSession } from "@fambrain/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
const LoginPage = async ({ searchParams, }: {
    searchParams: Promise<{
        reason?: string;
    }>;
}) => {
    const session = await getAuthSession();
    if (session?.status === "ACTIVE")
        redirect("/");
    if (session?.status === "PENDING")
        redirect("/pending");
    const sp = await searchParams;
    const rejected = sp.reason === "rejected";
    return (<div className="flex min-h-dvh flex-col items-center justify-center bg-[#f3f4f6] px-4 py-12 dark:bg-[#0a0a0a]">
      <div className="w-full max-w-sm rounded-2xl border border-[#e5e7eb] bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-[#111827] dark:text-neutral-100">
        <div className="mb-8 text-center">
          <Link href="/" className="text-[18px] font-bold tracking-tight text-[#4f46e5] hover:underline">
            FamBrain
          </Link>
          <p className="mt-2 text-[13px] text-[#6b7280]">家庭办公与学习记录助手</p>
        </div>
        {rejected ? (<div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-900">
            该账号未通过审核或已被管理员拒绝登录，如有疑问请联系家庭管理员。
          </div>) : null}
        <LoginForm />
      </div>
    </div>);
};
export default LoginPage;
