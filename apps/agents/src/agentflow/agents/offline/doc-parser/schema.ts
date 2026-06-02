import { z } from "zod";

import { SCAN_FOLDERS } from "@/agentflow/knowledge";

export const docParseCategorySchema = z.enum(SCAN_FOLDERS);

export const docParseFormatSchema = z.enum([
  "pdf",
  "word",
  "ppt",
  "image",
  "unsupported",
]);

export const parsedDocumentSchema = z.object({
  fileName: z.string().min(1),
  format: docParseFormatSchema,
  title: z.string().min(1),
  text: z.string(),
  vaultRelativePath: z.string().min(1),
  corpusRelativePath: z.string().min(1),
});

export type ParsedDocument = z.infer<typeof parsedDocumentSchema>;

export const docParseFileResultSchema = z.object({
  fileName: z.string().min(1),
  ok: z.boolean(),
  format: docParseFormatSchema.optional(),
  vaultRelativePath: z.string().optional(),
  corpusRelativePath: z.string().optional(),
  title: z.string().optional(),
  textLength: z.number().int().min(0).optional(),
  error: z.string().optional(),
});

export type DocParseFileResult = z.infer<typeof docParseFileResultSchema>;

export const docParseBatchResultSchema = z.object({
  corpusUserId: z.string().min(1),
  actorUserId: z.string().min(1),
  category: docParseCategorySchema,
  indexed: z.boolean(),
  indexResult: z
    .object({
      fileCount: z.number().int().min(0),
      chunkCount: z.number().int().min(0),
    })
    .optional(),
  files: z.array(docParseFileResultSchema),
});

export type DocParseBatchResult = z.infer<typeof docParseBatchResultSchema>;

export const docUploadFieldSchema = z.object({
  corpusUserId: z.string().min(1),
  category: docParseCategorySchema.default("personal"),
  indexAfter: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return true;
      if (typeof v === "boolean") return v;
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes" || s === "on";
    }),
});

export type DocUploadFields = z.infer<typeof docUploadFieldSchema>;
