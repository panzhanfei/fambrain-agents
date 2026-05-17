import Link from "next/link";
import { LogoutLink } from "@/components/auth/logout-button";
import { getAuthSession } from "@/lib/auth/session";

export default async function MePage() {
  const session = await getAuthSession();
  if (!session) return null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 px-6 py-10 text-[15px] text-[#374151]">
      <header>
        <h1 className="text-xl font-semibold text-[#111827]">我的资料</h1>
        <p className="mt-1 text-[13px] text-[#6b7280]">FamBrain 家庭空间 · 已通过审核的成员信息</p>
      </header>
      <dl className="space-y-3 rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-[#111827] dark:text-neutral-200">
        <div>
          <dt className="text-[12px] font-medium uppercase tracking-wide text-[#9ca3af] dark:text-neutral-500">
            登录名
          </dt>
          <dd className="mt-0.5">{session.username}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-medium uppercase tracking-wide text-[#9ca3af] dark:text-neutral-500">
            称呼
          </dt>
          <dd className="mt-0.5">{session.displayName}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-medium uppercase tracking-wide text-[#9ca3af] dark:text-neutral-500">
            与本人关系
          </dt>
          <dd className="mt-0.5">{session.relationToPrincipal}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-medium uppercase tracking-wide text-[#9ca3af] dark:text-neutral-500">
            身份证号（掩码）
          </dt>
          <dd className="mt-0.5">{session.nationalIdLast4}</dd>
        </div>
      </dl>
      <nav className="flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-full border border-[#e5e7eb] px-4 py-2 text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb] dark:border-neutral-600 dark:hover:bg-neutral-800"
        >
          返回对话
        </Link>
        {session.canManageMembers ? (
          <Link
            href="/admin/users"
            className="rounded-full bg-[#4f46e5] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#4338ca]"
          >
            审核成员
          </Link>
        ) : null}
        <LogoutLink />
      </nav>
    </div>
  );
}
