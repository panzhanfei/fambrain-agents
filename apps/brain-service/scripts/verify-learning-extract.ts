import assert from "node:assert/strict";
import { extractLearnedCandidates } from "@/agentflow/agents/offline/learning/extract-candidates";

const rows = extractLearnedCandidates({
    userQuestion: "请记住我的QQ是123456789",
    assistantAnswer: "好的，已记住。",
});
assert.equal(rows.length, 1);
assert.equal(rows[0]?.factKey, "qq");
assert.ok(rows[0]?.value.includes("123456789"));

const pref = extractLearnedCandidates({
    userQuestion: "我更喜欢 React 而不是 Vue",
    assistantAnswer: "了解。",
});
assert.equal(pref.length, 1);
assert.equal(pref[0]?.factKey, "preference");

console.log("verify:learning-extract ok");
