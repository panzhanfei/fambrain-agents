import path from "node:path";
import mammoth from "mammoth";
import { OfficeParser } from "officeparser";
import { PDFParse } from "pdf-parse";
import type { ParsedDocument } from "./schema";
import { detectDocFormat, slugifyBaseName } from "./supported-formats";
import { parseImageWithOllamaOcr } from "./parse-image-ocr";
const titleFromFileName = (fileName: string): string => {
    return path.basename(fileName, path.extname(fileName)).trim() || fileName;
};
const parsePdf = async (buffer: Buffer): Promise<string> => {
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        return result.text.trim();
    }
    finally {
        await parser.destroy();
    }
};
const parseDocxWithMammoth = async (buffer: Buffer): Promise<string> => {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim();
};
const parseWithOfficeParser = async (buffer: Buffer, _fileName: string): Promise<string> => {
    const ast = await OfficeParser.parseOffice(buffer, {
        ocr: true,
        newlineDelimiter: "\n",
    });
    const converted = await ast.to("text");
    const raw = converted.value;
    if (typeof raw === "string" && raw.trim())
        return raw.trim();
    return ast.toText().trim();
};
export const parseDocumentContent = async (buffer: Buffer, fileName: string): Promise<{
    format: ParsedDocument["format"];
    title: string;
    text: string;
}> => {
    const format = detectDocFormat(fileName);
    const title = titleFromFileName(fileName);
    if (format === "unsupported") {
        throw new Error(`不支持的文件类型：${path.extname(fileName) || fileName}`);
    }
    let text = "";
    if (format === "pdf") {
        try {
            text = await parsePdf(buffer);
        }
        catch {
            text = await parseWithOfficeParser(buffer, fileName);
        }
    }
    else if (format === "word") {
        const ext = path.extname(fileName).toLowerCase();
        if (ext === ".docx") {
            try {
                text = await parseDocxWithMammoth(buffer);
            }
            catch {
                text = await parseWithOfficeParser(buffer, fileName);
            }
        }
        else {
            text = await parseWithOfficeParser(buffer, fileName);
        }
    }
    else if (format === "ppt") {
        text = await parseWithOfficeParser(buffer, fileName);
    }
    else if (format === "image") {
        text = await parseImageWithOllamaOcr(buffer, fileName);
    }
    if (!text.trim()) {
        throw new Error(`未能从 ${fileName} 提取有效文本`);
    }
    return {
        format,
        title,
        text: text.trim(),
    };
};
export const parseDocumentBuffer = async (buffer: Buffer, fileName: string, paths: {
    vaultRelativePath: string;
    corpusRelativePath: string;
}): Promise<ParsedDocument> => {
    const content = await parseDocumentContent(buffer, fileName);
    return {
        fileName,
        ...content,
        vaultRelativePath: paths.vaultRelativePath,
        corpusRelativePath: paths.corpusRelativePath,
    };
};
export const buildOutputPaths = (actorUserId: string, corpusUserId: string, category: string, fileName: string): {
    vaultRelativePath: string;
    corpusRelativePath: string;
    mdFileName: string;
} => {
    const slug = slugifyBaseName(fileName);
    const stamp = Date.now().toString(36);
    const safeOriginal = fileName.replace(/[^\w.\-()\u4e00-\u9fff]+/g, "_");
    const mdFileName = `${slug}-${stamp}.md`;
    const vaultRelativePath = path
        .join("users", actorUserId, "vault", "originals", "uploads", safeOriginal)
        .split(path.sep)
        .join("/");
    const corpusRelativePath = path
        .join("users", corpusUserId, "corpus", category, "imports", mdFileName)
        .split(path.sep)
        .join("/");
    return { vaultRelativePath, corpusRelativePath, mdFileName };
};
