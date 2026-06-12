/**
 * vault 只读列目录单测（不依赖 Ollama）。
 *
 *   pnpm run verify:vault-list
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const main = async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fambrain-vault-"));
    const userId = "verify-user";
    const uploads = path.join(tmp, "users", userId, "vault", "originals", "uploads");
    await mkdir(uploads, { recursive: true });
    await writeFile(path.join(uploads, "demo.pdf"), "pdf-bytes");
    const prevDocRoot = process.env.FAMBRAIN_DOC_ROOT_OVERRIDE;
    process.env.FAMBRAIN_DOC_ROOT_OVERRIDE = tmp;
    const { listVaultFiles } = await import("@fambrain/corpus");
    const files = await listVaultFiles(userId);
    assert.equal(files.length, 1);
    assert.match(files[0].relativePath, /originals\/uploads\/demo\.pdf$/);
    assert.ok(files[0].sizeBytes > 0);
    if (prevDocRoot === undefined)
        delete process.env.FAMBRAIN_DOC_ROOT_OVERRIDE;
    else
        process.env.FAMBRAIN_DOC_ROOT_OVERRIDE = prevDocRoot;
    await rm(tmp, { recursive: true, force: true });
    console.log("verify:vault-list OK");
};
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
