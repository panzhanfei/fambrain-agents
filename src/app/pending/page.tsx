import { LogoutLink } from "@/components/auth/logout-button";
import Link from "next/link";
import { getAuthSession } from "@/lib/auth/session";

export default async function PendingPage() {
  const session = await getAuthSession();
  const name = session?.displayName ?? "成员";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-xl font-semibold text-[#111827]">你好，{name}</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[#4b5563]">
        管理员尚未通过你的注册申请；通过后即可访问 FamBrain（对话记录、备份与文档整理）。
      </p>
      <div className="mt-8 flex flex-wrap gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-[13px] leading-relaxed text-amber-950 dark:border-amber-800 dark:bg-[#362500] dark:text-[#fcd34d]">
        <p>
          <strong className="font-semibold">提示：</strong>
          通过审核后会自动获得访问权限——请稍后点击「我已通过审核」或直接重新登录刷新状态。
        </p>
      </div>
      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          href="/login"
          className="rounded-full bg-[#4f46e5] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#4338ca]"
        >
          重新登录刷新状态
        </Link>
        <LogoutLink />
      </div>
    </div>
  );
}
