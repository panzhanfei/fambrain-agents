import type { IncomingMessage } from "node:http";

import Busboy from "busboy";

export type ParsedMultipartFile = {
  fileName: string;
  buffer: Buffer;
  mimeType?: string;
};

export type ParsedMultipart = {
  fields: Record<string, string>;
  files: ParsedMultipartFile[];
};

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_FILES = 20;

export async function parseMultipartRequest(
  req: IncomingMessage,
  maxFileBytes = MAX_FILE_BYTES
): Promise<ParsedMultipart> {
  const contentType = req.headers["content-type"];
  if (!contentType?.includes("multipart/form-data")) {
    throw new Error("Content-Type 必须是 multipart/form-data");
  }

  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: ParsedMultipartFile[] = [];
    let totalBytes = 0;

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: MAX_FILES,
        fileSize: maxFileBytes,
      },
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (_field, file, info) => {
      const chunks: Buffer[] = [];
      let fileBytes = 0;

      file.on("data", (chunk: Buffer) => {
        fileBytes += chunk.length;
        totalBytes += chunk.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
          file.destroy();
          reject(new Error("批量上传总大小超限"));
          return;
        }
        chunks.push(chunk);
      });

      file.on("limit", () => {
        reject(new Error(`单文件大小超限（>${maxFileBytes} bytes）`));
      });

      file.on("end", () => {
        if (fileBytes === 0) return;
        files.push({
          fileName: info.filename || "upload.bin",
          buffer: Buffer.concat(chunks),
          mimeType: info.mimeType,
        });
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", () => resolve({ fields, files }));

    req.pipe(busboy);
  });
}
