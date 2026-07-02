import { createServer } from "node:http";
import { bootstrapAgentsRuntime, logLangSmithStartup, } from "@/config";
import { handleAsync } from "@/server/handle-async";
import { handleHealth, handleNotFound, handlePipelineStream, } from "@/server/routes";
import { handleDocumentsUpload } from "@/server/documents-upload";
import { handleLearningApply } from "@/server/learning-apply";

const { langSmith, port } = bootstrapAgentsRuntime();

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
    if (url === "/documents/upload") {
        handleAsync(handleDocumentsUpload)(req, res);
        return;
    }
    if (url === "/learning/apply") {
        handleAsync(handleLearningApply)(req, res);
        return;
    }
    handleNotFound(res);
});

server.listen(port, () => {
    console.log(`[@fambrain/agents] listening on http://127.0.0.1:${port}`);
    logLangSmithStartup(langSmith);
});
