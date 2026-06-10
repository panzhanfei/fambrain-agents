import { z } from "zod";

import { dedupeCitations } from "@/agentflow/agents/online/content-organizer";
import { unitInterval } from "@/agentflow/utils";

import type { Citation, InformationAnalystResult } from "./prompt";

export const citationSchema = z.object({
  path: z.string().trim().min(1),
  excerpt: z.string().trim().min(1),
});

export const informationAnalystResultSchema = z.object({
  answer: z.string().trim().min(1),
  citations: z.array(citationSchema).catch([]),
  confidence: unitInterval,
  insufficientEvidence: z.coerce.boolean(),
});

/** 校验并规范化信息分析师模型输出的 JSON */
export function parseAnalystResult(
  raw: unknown,
  fallback: InformationAnalystResult
): InformationAnalystResult {
  const parsed = informationAnalystResultSchema.safeParse(raw);
  if (!parsed.success) return fallback;

  return {
    answer: parsed.data.answer,
    citations: dedupeCitations(parsed.data.citations as Citation[]),
    confidence: parsed.data.confidence,
    insufficientEvidence: parsed.data.insufficientEvidence,
  };
}
