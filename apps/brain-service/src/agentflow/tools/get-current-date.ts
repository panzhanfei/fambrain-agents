import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const getCurrentDateTool = tool(
    async () => {
        const now = new Date();
        return JSON.stringify({
            asOfDate: now.toISOString().slice(0, 10),
            iso: now.toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
    },
    {
        name: "get_current_date",
        description:
            "返回服务端当前日期（YYYY-MM-DD），用于年龄等需 asOfDate 的计算。",
        schema: z.object({}),
    }
);
