import path from "node:path";

import type { z } from "zod";

import { docParseFormatSchema } from "./schema";

export type DocParseFormat = z.infer<typeof docParseFormatSchema>;

const PDF_EXT = new Set([".pdf"]);
const WORD_EXT = new Set([".doc", ".docx"]);
const PPT_EXT = new Set([".ppt", ".pptx"]);
const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
]);

export function detectDocFormat(fileName: string): DocParseFormat {
  const ext = path.extname(fileName).toLowerCase();
  if (PDF_EXT.has(ext)) return "pdf";
  if (WORD_EXT.has(ext)) return "word";
  if (PPT_EXT.has(ext)) return "ppt";
  if (IMAGE_EXT.has(ext)) return "image";
  return "unsupported";
}

export function isSupportedDocFile(fileName: string): boolean {
  return detectDocFormat(fileName) !== "unsupported";
}

export function slugifyBaseName(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName));
  const slug = base
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "document";
}
