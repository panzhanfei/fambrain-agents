"use server";

import { getRequestIpKey } from "@/lib/security/client-ip";
import { loginUser } from "@fambrain/auth";
import { registerUser } from "@fambrain/auth";
import { headers } from "next/headers";

export type AuthActionResult =
  | { ok: true; redirect: string }
  | { ok: false; error: string };

async function clientIpKey(): Promise<string> {
  const h = await headers();
  return getRequestIpKey(h);
}

export async function loginAction(input: {
  username: string;
  password: string;
}): Promise<AuthActionResult> {
  const result = await loginUser(input, await clientIpKey());
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, redirect: result.redirect };
}

export async function registerAction(input: {
  username: string;
  password: string;
  nationalId: string;
  displayName: string;
  relationToPrincipal: string;
}): Promise<AuthActionResult> {
  const result = await registerUser(input, await clientIpKey());
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, redirect: result.redirect };
}
