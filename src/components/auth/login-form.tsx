"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      if (!res.ok) {
        let msg = "登录失败";
        try {
          const body = await res.json();
          if (body?.error && typeof body.error === "string") msg = body.error;
        } catch {
          //
        }
        setErr(msg);
        return;
      }
      const body = (await res.json()) as { redirect?: string };
      router.push(body.redirect ?? "/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)}>
      {err ? (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] leading-snug text-red-800">{err}</div>
      ) : null}
      <div>
        <label className="mb-1 block text-[13px] font-medium text-[#374151]" htmlFor="username">
          用户名
        </label>
        <input
          id="username"
          autoComplete="username"
          required
          className="w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-[15px] outline-none focus:border-[#4f46e5] dark:border-neutral-600 dark:bg-[#111]"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-[13px] font-medium text-[#374151]" htmlFor="password">
          密码
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-[15px] outline-none focus:border-[#4f46e5] dark:border-neutral-600 dark:bg-[#111]"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-[#4f46e5] py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
      >
        {loading ? "登录中…" : "登录"}
      </button>
      <p className="text-center text-[13px] text-[#6b7280]">
        还没有账号？{" "}
        <Link href="/register" className="font-semibold text-[#4f46e5] hover:underline">
          注册
        </Link>
      </p>
    </form>
  );
}
