import { tool } from "@langchain/core/tools";
import {
    addStructuredUserFact,
    searchUserFactMemories,
} from "@fambrain/agent-memory";
import { z } from "zod";
import { findUserFactValueInTexts } from "@/agentflow/agents/online/intake-coordinator";
import { getToolContext } from "./context";

export const rememberUserFactTool = tool(
    async (input) => {
        const { actorUserId } = getToolContext();
        await addStructuredUserFact({
            userId: actorUserId,
            factKey: input.factKey,
            label: input.label,
            value: input.value,
        });
        return JSON.stringify({
            ok: true,
            action: "remember",
            factKey: input.factKey,
            label: input.label,
        });
    },
    {
        name: "remember_user_fact",
        description:
            "将用户明确提供的结构化事实写入跨会话 Mem0（如 QQ、电话、邮箱）。仅用于用户明确要求「记住」的场景。",
        schema: z.object({
            factKey: z
                .string()
                .min(1)
                .describe("事实键，如 qq / phone / email / wechat"),
            label: z.string().min(1).describe("展示标签，如「QQ号」"),
            value: z.string().min(1).describe("事实值"),
        }),
    }
);

export const recallUserFactTool = tool(
    async (input) => {
        const { actorUserId } = getToolContext();
        const query =
            input.userQuestion?.trim() ||
            `我的${input.label}是多少`;
        const memories = await searchUserFactMemories(
            actorUserId,
            input.factKey,
            input.label,
            query
        );
        const value = findUserFactValueInTexts(
            memories,
            input.factKey,
            input.label
        );
        return JSON.stringify({
            found: Boolean(value),
            factKey: input.factKey,
            label: input.label,
            value,
            memoryCount: memories.length,
        });
    },
    {
        name: "recall_user_fact",
        description:
            "从 Mem0 召回用户此前 remember 的结构化事实（跨会话）。用于用户问「我的 QQ 是多少」等。",
        schema: z.object({
            factKey: z.string().min(1).describe("事实键，如 qq / phone"),
            label: z.string().min(1).describe("展示标签，如「QQ号」"),
            userQuestion: z
                .string()
                .optional()
                .describe("用户原问，用于 Mem0 语义检索"),
        }),
    }
);
