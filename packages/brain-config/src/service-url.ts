import process from "node:process";
export const resolveHttpServiceUrl = (options: {
    urlVar: string;
    hostVar: string;
    portVar: string;
    defaultHost: string;
    defaultPort: string;
}): string => {
    const explicit = process.env[options.urlVar]?.trim();
    if (explicit)
        return explicit.replace(/\/+$/, "");
    const host = process.env[options.hostVar]?.trim() || options.defaultHost;
    const port = process.env[options.portVar]?.trim() || options.defaultPort;
    return `http://${host}:${port}`;
};
export const resolveOllamaBaseUrl = (): string => {
    return resolveHttpServiceUrl({
        urlVar: "OLLAMA_BASE_URL",
        hostVar: "OLLAMA_HOST",
        portVar: "OLLAMA_PORT",
        defaultHost: "127.0.0.1",
        defaultPort: "11434",
    });
};
export const resolveChromaServerUrl = (): string => {
    return resolveHttpServiceUrl({
        urlVar: "CHROMA_SERVER_URL",
        hostVar: "CHROMA_HOST",
        portVar: "CHROMA_PORT",
        defaultHost: "127.0.0.1",
        defaultPort: "8030",
    });
};
export const resolveBrainServicePort = (): number => {
    const raw = process.env.BRAIN_SERVICE_PORT?.trim() || "3001";
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 3001;
};
export const resolveBrainServiceUrl = (): string => {
    return resolveHttpServiceUrl({
        urlVar: "BRAIN_SERVICE_URL",
        hostVar: "BRAIN_SERVICE_HOST",
        portVar: "BRAIN_SERVICE_PORT",
        defaultHost: "127.0.0.1",
        defaultPort: "3001",
    });
};
