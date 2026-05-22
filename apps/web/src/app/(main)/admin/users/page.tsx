import Link from "next/link";
import { redirect } from "next/navigation";
import { UserReviewTable } from "@/components/admin/user-review-table";
import { getAuthSession } from "@fambrain/auth";

export default async function AdminUsersPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">成员与审核</h1>
          <p className="mt-1 text-[13px] text-[#6b7280]">
            你已具备成员管理权限（身份证号匹配配置的尾缀），可操作审核与删除
          </p>
        </div>
        <Link
          href="/"
          className="rounded-full border border-[#e5e7eb] px-4 py-2 text-center text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb]"
        >
          返回对话
        </Link>
      </header>
      <UserReviewTable currentUserId={session.userId} />
    </div>
  );
}
