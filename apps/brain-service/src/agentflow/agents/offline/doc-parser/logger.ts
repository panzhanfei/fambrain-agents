import pino from "pino";
export const docParserLogger = pino({
    name: "fambrain-doc-parser",
    level: process.env.LOG_LEVEL ?? "info",
});
