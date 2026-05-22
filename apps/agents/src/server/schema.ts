import { z } from "zod";

const chatTurnSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

export const pipelineStreamBodySchema = z.object({
  history: z.array(chatTurnSchema).min(1),
  context: z.object({
    actorUserId: z.string().min(1),
    corpusUserId: z.string().min(1),
    displayName: z.string().min(1),
  }),
});
