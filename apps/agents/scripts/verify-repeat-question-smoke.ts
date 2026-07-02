/**
 * 同问短路冒烟：预置 history，不调用 Ollama。
 */
import { runPipelineStream } from "@/agentflow/index";
import { bootstrapAgentsRuntime } from "@/config";
import { listCorpusUserIds } from "@/agentflow/agents/offline/knowledge-indexer/list-corpus-users";
import { enableRepeatGuardForVerify } from "./verify-test-env";

await bootstrapAgentsRuntime();
enableRepeatGuardForVerify();
const corpusUserId =
    process.env.FAMBRAIN_CORPUS_USER_ID?.trim() ||
    (await listCorpusUserIds())[0];
if (!corpusUserId) {
    console.error("无 corpus");
    process.exit(1);
}

const q =
    "我叫什么，我做过什么项目，我在那几家公司上过班，近两年在干什么？";
const prior =
    "你是潘展飞。曾在云联智慧、友谊时光、奖多多、奥卡云工作。近两年做开源探索。";
const history = [
    { role: "user" as const, content: q },
    { role: "assistant" as const, content: prior },
    { role: "user" as const, content: q },
];

const started = Date.now();
const steps: string[] = [];
const gen = runPipelineStream(history, {
    actorUserId: corpusUserId,
    corpusUserId,
    displayName: "RepeatSmoke",
    conversationId: `repeat-smoke-${Date.now()}`,
});
let repeatHit = false;
while (true) {
    const next = await gen.next();
    if (next.done) {
        repeatHit = next.value.repeatQuestionHit ?? false;
        break;
    }
    const ev = next.value;
    if (ev.type === "step" && ev.status === "running") steps.push(ev.name);
}

console.log(
    `repeatHit=${repeatHit} steps=[${steps.join(",")}] ${Date.now() - started}ms`
);
if (!repeatHit || steps.join(",") !== "prepare_turn") {
    process.exit(1);
}
console.log("OK");
