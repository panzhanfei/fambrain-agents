"use client";
import { useRouter } from "next/navigation";
export const LogoutLink = () => {
    const router = useRouter();
    return (<button type="button" onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.push("/login");
            router.refresh();
        }} className="rounded-full border border-[#fca5a5] px-4 py-2 text-[13px] font-medium text-[#991b1b] hover:bg-red-50">
      退出登录
    </button>);
};
