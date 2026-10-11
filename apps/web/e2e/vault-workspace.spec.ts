import { expect, test } from "@playwright/test";

const user = process.env.E2E_USER ?? "panzhanfei";
const password = process.env.E2E_PASSWORD ?? "12345678";

const readSse = (
  text: string
): { answer: string; jobId?: string } => {
  let answer = "";
  let jobId: string | undefined;
  let err: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const ev = JSON.parse(payload) as {
        type?: string;
        text?: string;
        answer?: string;
        error?: string;
        jobId?: string;
      };
      if (ev.type === "assistant" && typeof ev.text === "string") {
        answer += ev.text;
      }
      if (typeof ev.answer === "string" && ev.answer.trim()) {
        answer = ev.answer;
      }
      if (typeof ev.jobId === "string" && ev.jobId) jobId = ev.jobId;
      if (typeof ev.error === "string") err = ev.error;
    } catch {
      /* ignore */
    }
  }
  if (!answer && err) throw new Error(`pipeline error: ${err}`);
  return { answer, jobId };
};

test.describe("vault workspace UI", () => {
  test("login → list → 点击新建 txt → 删除", async ({ page, baseURL }) => {
    const origin = baseURL ?? "http://127.0.0.1:3000";
    const stamp = Date.now().toString(36);
    const title = `pw-vault-${stamp}`;

    const loginRes = await page.request.post("/api/auth/login", {
      data: { username: user, password },
      headers: { Origin: origin },
    });
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();

    const convRes = await page.request.post("/api/conversations", {
      data: { title },
      headers: { Origin: origin },
    });
    expect(convRes.ok(), await convRes.text()).toBeTruthy();
    const conv = (await convRes.json()) as { id: string };

    const msgRes = await page.request.post(
      `/api/conversations/${conv.id}/messages`,
      {
        data: { content: "我的原文库" },
        headers: { Origin: origin },
      }
    );
    const sseText = await msgRes.text();
    expect(msgRes.ok(), sseText.slice(0, 400)).toBeTruthy();
    const listed = readSse(sseText);
    expect(listed.answer.length, sseText.slice(0, 400)).toBeGreaterThan(0);
    expect(listed.jobId, "list pause jobId").toBeTruthy();

    await page.goto("/");
    await expect(page.getByText(title).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByText(title).first().click();
    await expect(page.getByRole("button", { name: "日志" })).toBeEnabled({
      timeout: 20_000,
    });
    await expect(page.getByText("我的原文库").first()).toBeVisible({
      timeout: 20_000,
    });

    await page
      .getByRole("button", { name: /新建 txt/i, disabled: false })
      .last()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "新建 txt" })).toBeVisible();
    await dialog.getByLabel("文件名").fill(`pw-${stamp}`);
    await dialog.getByRole("button", { name: "确定" }).click();
    const created = page.getByText(new RegExp(`已新建\\s+pw-${stamp}\\.txt`)).first();
    await expect(created).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0, {
      timeout: 60_000,
    });

    const createdText = (await created.innerText()).trim();
    const fileRel = createdText.match(/已新建\s+(\S+\.txt)/i)?.[1]
      ?? createdText.match(/Created\s+(\S+\.txt)/i)?.[1];
    expect(fileRel, createdText).toBeTruthy();
    const delPrompt = `__FAMBRAIN_VAULT_WS_DELETE_FILE__:${fileRel}`;
    const delRes = await page.request.post(
      `/api/conversations/${conv.id}/messages`,
      {
        data: {
          content: `删除 ${fileRel}`,
          routingContent: delPrompt,
          resume: {
            kind: "vault_action",
            jobId: listed.jobId,
            prompt: delPrompt,
          },
        },
        headers: { Origin: origin },
      }
    );
    const delSse = readSse(await delRes.text());
    expect(delRes.ok(), delSse.answer.slice(0, 400)).toBeTruthy();
    expect(delSse.answer).toMatch(/已硬删除|Hard-deleted|入队硬删/);
  });
});
