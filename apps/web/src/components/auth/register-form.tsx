"use client";

import { registerAction } from "@/actions/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RegisterForm({ hintBootstrap }: { hintBootstrap: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [relationToPrincipal, setRelationToPrincipal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const result = await registerAction({
        username: username.trim(),
        password,
        nationalId: nationalId.trim(),
        displayName: displayName.trim(),
        relationToPrincipal: relationToPrincipal.trim(),
      });

      if (!result.ok) {
        setErr(result.error);
        return;
      }

      router.push(result.redirect);
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={(e) => void submit(e)}>
      {hintBootstrap ? (
        <div className="rounded-lg bg-[#eef2ff] px-3 py-2 text-[12px] leading-relaxed text-[#3730a3]">
          当前还没有任何家庭成员账号：本次注册将作为<strong className="font-semibold">首个管理员</strong>
          ，无需他人审核。
        </div>
      ) : (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-950">
          注册后需在「审核成员」中获得管理员同意后，才可使用 FamBrain。
        </div>
      )}
      {err ? (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] leading-snug text-red-800">{err}</div>
      ) : null}
      <Field label="登录用户名" htmlFor="reg-u">
        <input
          id="reg-u"
          required
          autoComplete="username"
          className="w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-[15px] outline-none focus:border-[#4f46e5] dark:border-neutral-600 dark:bg-[#111]"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label="密码（至少 8 位）" htmlFor="reg-p">
        <input
          id="reg-p"
          required
          type="password"
          autoComplete="new-password"
          className="w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-[15px] outline-none focus:border-[#4f46e5] dark:border-neutral-600 dark:bg-[#111]"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label="身份证号" htmlFor="reg-id">
        <input
          id="reg-id"
          required
          autoComplete="off"
          className="w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-[15px] outline-none focus:border-[#4f46e5] dark:border-neutral-600 dark:bg-[#111]"
          value={nationalId}
          onChange={(e) => setNationalId(e.target.value)}
        />
      </Field>
      <Field label="家庭成员称呼（展示名）" htmlFor="reg-dn">
        <input
          id="reg-dn"
          required
          className="w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-[15px] outline-none focus:border-[#4f46e5] dark:border-neutral-600 dark:bg-[#111]"
          placeholder="例如：爸爸、小雅"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <Field label="与本人（家庭主办）关系" htmlFor="reg-rel">
        <input
          id="reg-rel"
          required
          className="w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-[15px] outline-none focus:border-[#4f46e5] dark:border-neutral-600 dark:bg-[#111]"
          placeholder="例如：本人、配偶、长子"
          value={relationToPrincipal}
          onChange={(e) => setRelationToPrincipal(e.target.value)}
        />
      </Field>
      <button
        type="submit"
        disabled={loading}
        className="mt-2 w-full rounded-lg bg-[#4f46e5] py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
      >
        {loading ? "提交中…" : "提交注册"}
      </button>
      <p className="text-center text-[13px] text-[#6b7280]">
        已有账号？{" "}
        <Link href="/login" className="font-semibold text-[#4f46e5] hover:underline">
          登录
        </Link>
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-medium text-[#374151]" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
