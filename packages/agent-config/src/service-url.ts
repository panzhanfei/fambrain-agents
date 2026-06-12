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
export const resolveAgentsPort = (): number => {
    const raw = process.env.AGENTS_PORT?.trim() || "3001";
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 3001;
};
export const resolveAgentsServiceUrl = (): string => {
    return resolveHttpServiceUrl({
        urlVar: "AGENTS_SERVICE_URL",
        hostVar: "AGENTS_HOST",
        portVar: "AGENTS_PORT",
        defaultHost: "127.0.0.1",
        defaultPort: "3001",
    });
};
