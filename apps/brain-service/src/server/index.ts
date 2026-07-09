import { createServer } from "node:http";
import { bootstrapBrainServiceRuntime, logLangSmithStartup, } from "@/config";
import { handleAsync } from "@/server/handle-async";
import { handleHealth, handleNotFound, handlePipelineStream, } from "@/server/routes";
import { handleDocumentsUpload } from "@/server/documents-upload";
import { handleLearningApply } from "@/server/learning-apply";
import { handleEnumerationList } from "@/server/enumeration-list";

const { langSmith, port } = bootstrapBrainServiceRuntime();

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
    if (url === "/enumeration/list") {
        handleAsync(handleEnumerationList)(req, res);
        return;
    }
    handleNotFound(res);
});

server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
        console.error(
            `[@fambrain/brain-service] port ${port} already in use — another brain-service instance may still be running.\n` +
                `  Stop it: kill $(lsof -t -i :${port})`
        );
        process.exit(1);
    }
    throw err;
});

server.listen(port, () => {
    console.log(`[@fambrain/brain-service] listening on http://127.0.0.1:${port}`);
    logLangSmithStartup(langSmith);
});
