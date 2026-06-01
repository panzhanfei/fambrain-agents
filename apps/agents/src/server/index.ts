import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAgentsPort } from "@fambrain/agent-config/service-url";
import { config as loadEnv } from "dotenv";

import { handleAsync } from "@/server/handle-async";
import {
  handleHealth,
  handleNotFound,
  handlePipelineStream,
} from "@/server/routes";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);
loadEnv({ path: path.join(repoRoot, ".env") });

const port = resolveAgentsPort();

const server = createServer((req, res) => {
  const url = req.url?.split("?")[0] ?? "/";

  if (url === "/health") {
    handleAsync(handleHealth)(req, res);
    return;
  }

  if (url === "/pipeline/stream") {
    handleAsync(handlePipelineStream)(req, res);
    return;
  }

  handleNotFound(res);
});

server.listen(port, () => {
  console.log(`[@fambrain/agents] listening on http://127.0.0.1:${port}`);
});
