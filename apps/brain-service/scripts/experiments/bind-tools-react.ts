/**
 * LangChain bindTools + 简易 ReAct 实验（不进主 pipeline / Golden / eval）。
 *
 *   pnpm --filter @fambrain/brain-service run experiment:bind-tools -- "我的名字是什么？"
 *   pnpm --filter @fambrain/brain-service run experiment:bind-tools -- --schema-only
 */
import {
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    type BaseMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { getBrainServiceConfig } from "@fambrain/brain-config";
import { bootstrapBrainServiceRuntime } from "@/config";
import { listCorpusUserIds } from "@/agentflow/brain-service/offline/knowledge-indexer/list-corpus-users";
import {
    createFambrainTools,
    runWithToolContext,
    type FambrainToolContext,
} from "@/agentflow/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";

const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT = `你是 FamBrain 实验助手（bindTools 触达脚本，非生产主链）。
根据用户问题选择工具，不要编造事实：
- 查履历/姓名/项目/公司/技术 → retrieve_corpus（传 searchQuery、合适的 queryType）
- 召回用户此前 remember 的结构化事实（如 QQ）→ recall_user_fact
- 只读列举 vault 私人原件 → list_vault_files
工具返回 JSON；无足够证据时如实说明。
最多连续调用 3 次工具，然后必须用中文给出简短最终回答。`;

const parseArgs = (): { schemaOnly: boolean; prompt: string } => {
    const argv = process.argv.slice(2);
    const schemaOnly = argv.includes("--schema-only");
    const prompt = argv.filter((a) => a !== "--schema-only").join(" ").trim();
    return {
        schemaOnly,
        prompt: prompt || "我的名字是什么？",
    };
};

const textFromMessage = (msg: AIMessage): string => {
    if (typeof msg.content === "string") return msg.content.trim();
    if (Array.isArray(msg.content)) {
        return msg.content
            .map((part) =>
                typeof part === "string" ? part : (part as { text?: string }).text ?? ""
            )
            .join("")
            .trim();
    }
    return "";
};

const invokeTool = async (
    toolsByName: Map<string, StructuredToolInterface>,
    ctx: FambrainToolContext,
    name: string,
    args: unknown
): Promise<string> => {
    const t = toolsByName.get(name);
    if (!t) {
        return JSON.stringify({ error: `unknown_tool:${name}` });
    }
    try {
        const out = await runWithToolContext(ctx, () => t.invoke(args));
        return typeof out === "string" ? out : JSON.stringify(out);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return JSON.stringify({ error: message });
    }
};

const runBindToolsReact = async (input: {
    prompt: string;
    ctx: FambrainToolContext;
    tools: StructuredToolInterface[];
}): Promise<{ answer: string; toolRounds: number; messages: BaseMessage[] }> => {
    const { ollama } = getBrainServiceConfig();
    const llm = new ChatOllama({
        baseUrl: ollama.baseUrl,
        model: ollama.models.intakeCoordinator,
        temperature: 0,
    }).bindTools(input.tools);

    const toolsByName = new Map(input.tools.map((t) => [t.name, t]));
    const messages: BaseMessage[] = [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(input.prompt),
    ];
    let toolRounds = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const ai = (await llm.invoke(messages)) as AIMessage;
        messages.push(ai);

        const calls = ai.tool_calls ?? [];
        if (calls.length === 0) {
            return {
                answer: textFromMessage(ai) || "（模型未返回文本）",
                toolRounds,
                messages,
            };
        }

        toolRounds += 1;
        console.log(
            `— tool round ${toolRounds}: ${calls.map((c) => c.name).join(", ")}`
        );

        for (const call of calls) {
            const raw =
                call.args && typeof call.args === "object" ? call.args : {};
            const content = await invokeTool(
                toolsByName,
                input.ctx,
                call.name,
                raw
            );
            console.log(`  ${call.name} → ${content.slice(0, 240)}${content.length > 240 ? "…" : ""}`);
            messages.push(
                new ToolMessage({
                    content,
                    tool_call_id: call.id ?? call.name,
                })
            );
        }
    }

    const last = messages[messages.length - 1];
    const answer =
        last instanceof AIMessage ?
            textFromMessage(last)
        :   "（已达最大工具轮次，未得到终稿）";
    return { answer, toolRounds, messages };
};

const main = async (): Promise<void> => {
    const { schemaOnly, prompt } = parseArgs();
    bootstrapBrainServiceRuntime();

    const tools = createFambrainTools().filter(
        (t) => t.name !== "summarize_text"
    );
    console.log(
        `experiment:bind-tools tools=[${tools.map((t) => t.name).join(", ")}]`
    );

    if (schemaOnly) {
        const { ollama } = getBrainServiceConfig();
        new ChatOllama({
            baseUrl: ollama.baseUrl,
            model: ollama.models.intakeCoordinator,
        }).bindTools(tools);
        console.log("schema-only OK（bindTools 绑定成功，未调用 Ollama）");
        return;
    }

    const corpusUserId =
        process.env.FAMBRAIN_CORPUS_USER_ID?.trim() ||
        (await listCorpusUserIds())[0];
    if (!corpusUserId) {
        console.error("无 corpus 用户；请配置 FAMBRAIN_CORPUS_USER_ID 或准备语料");
        process.exit(1);
    }

    const ctx: FambrainToolContext = {
        corpusUserId,
        actorUserId: corpusUserId,
    };

    console.log(`corpusUserId=${corpusUserId}`);
    console.log(`prompt=${prompt}\n`);

    const { answer, toolRounds } = await runBindToolsReact({
        prompt,
        ctx,
        tools,
    });

    console.log(`\n— answer (${toolRounds} tool round(s)) —\n${answer}`);
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
