"use client";

import { useEffect, useState } from "react";

type UserRow = {
  id: string;
  username: string;
  displayName: string;
  relationToPrincipal: string;
  nationalIdMasked: string;
  role: "ADMIN" | "MEMBER";
  status: "PENDING" | "ACTIVE" | "REJECTED";
  createdAt: string;
};

export function UserReviewTable({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    void (async () => {
      setErr(null);
      const res = await fetch("/api/users");
      if (!res.ok) {
        let msg = "加载失败";
        try {
          const b = await res.json();
          if (b?.error && typeof b.error === "string") msg = b.error;
        } catch {
          //
        }
        setErr(msg);
        setUsers(null);
        return;
      }
      const data = (await res.json()) as UserRow[];
      setUsers(data);
    })();
  };

  useEffect(() => {
    load();
  }, []);

  const act = async (id: string, status: "ACTIVE" | "REJECTED") => {
    setBusyId(id);
    setErr(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        let msg = status === "ACTIVE" ? "通过失败" : "拒绝失败";
        try {
          const b = await res.json();
          if (b?.error && typeof b.error === "string") msg = b.error;
        } catch {
          //
        }
        setErr(msg);
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const deleteUser = async (id: string, displayName: string) => {
    if (
      !window.confirm(
        `确认删除成员「${displayName}」吗？该账号及其对话记录将被永久删除（不可恢复）。`,
      )
    ) {
      return;
    }

    setBusyId(id);
    setErr(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        let msg = "删除失败";
        try {
          const b = await res.json();
          if (b?.error && typeof b.error === "string") msg = b.error;
        } catch {
          //
        }
        setErr(msg);
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => load()}
          className="rounded-full border border-[#e5e7eb] px-3 py-1.5 text-[12px] font-medium text-[#4b5563] hover:bg-[#f9fafb]"
        >
          刷新
        </button>
      </div>
      {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800">{err}</div> : null}
      {!users ? (
        <div className="rounded-xl border border-dashed border-[#e5e7eb] px-4 py-8 text-center text-[14px] text-[#9ca3af]">
          载入中…
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e5e7eb] px-4 py-8 text-center text-[14px] text-[#9ca3af]">
          暂无账号
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e5e7eb] bg-white shadow-sm">
          <table className="min-w-full border-collapse text-left text-[13px]">
            <thead className="bg-[#f9fafb] text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">
              <tr>
                <th className="border-b px-3 py-2">称呼</th>
                <th className="border-b px-3 py-2">登录名</th>
                <th className="border-b px-3 py-2">关系</th>
                <th className="border-b px-3 py-2">证件</th>
                <th className="border-b px-3 py-2">状态</th>
                <th className="border-b px-3 py-2">角色</th>
                <th className="border-b px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === currentUserId;
                return (
                  <tr key={u.id} className="even:bg-black/[0.02]">
                    <td className="border-b border-[#f3f4f6] px-3 py-2 font-medium text-[#111827]">
                      {u.displayName}
                    </td>
                    <td className="border-b border-[#f3f4f6] px-3 py-2 text-[#4b5563]">{u.username}</td>
                    <td className="border-b border-[#f3f4f6] px-3 py-2 text-[#4b5563]">
                      {u.relationToPrincipal}
                    </td>
                    <td className="border-b border-[#f3f4f6] px-3 py-2 font-mono text-[12px] text-[#6b7280]">
                      {u.nationalIdMasked}
                    </td>
                    <td className="border-b border-[#f3f4f6] px-3 py-2 font-medium">{statusLabel(u.status)}</td>
                    <td className="border-b border-[#f3f4f6] px-3 py-2">
                      {u.role === "ADMIN" ? "管理员" : "成员"}
                    </td>
                    <td className="border-b border-[#f3f4f6] px-3 py-2">
                      <div className="flex min-h-[32px] flex-wrap items-center justify-end gap-2">
                        {self ? (
                          <span className="text-[12px] text-[#9ca3af]">当前登录</span>
                        ) : u.status === "PENDING" ? (
                          <>
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => void act(u.id, "ACTIVE")}
                              className="rounded-full bg-[#4f46e5] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
                            >
                              同意
                            </button>
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => void act(u.id, "REJECTED")}
                              className="rounded-full border border-[#e5e7eb] px-3 py-1 text-[12px] font-medium text-[#991b1b] hover:bg-red-50 disabled:opacity-40"
                            >
                              拒绝
                            </button>
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => void deleteUser(u.id, u.displayName)}
                              className="rounded-full border border-[#fca5a5] px-3 py-1 text-[12px] font-medium text-[#991b1b] hover:bg-red-50 disabled:opacity-40"
                            >
                              删除
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => void deleteUser(u.id, u.displayName)}
                              className="rounded-full border border-[#fca5a5] px-3 py-1 text-[12px] font-medium text-[#991b1b] hover:bg-red-50 disabled:opacity-40"
                            >
                              删除
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function statusLabel(s: UserRow["status"]): string {
  switch (s) {
    case "PENDING":
      return "待审核";
    case "ACTIVE":
      return "已通过";
    case "REJECTED":
      return "未通过";
    default:
      return s;
  }
}
