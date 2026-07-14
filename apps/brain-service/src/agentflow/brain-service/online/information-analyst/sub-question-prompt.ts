import type { QueryProfile } from "@/agentflow/brain-service/online/knowledge-manager";
import { isProjectEnumeration } from "@/agentflow/brain-service/online/intake-coordinator";

const streamRulesBase = `- 无 hits：只写一句「知识库未覆盖此点」。
- 禁止编造 hits 中不存在的人名、公司、项目、日期。`;

export const subQuestionStreamRulesForProfile = (
    profile: QueryProfile,
    topics: string[] = []
): string => {
    const projectEnum =
        profile === "enumeration" &&
        isProjectEnumeration({ label: "", searchQuery: "", topics });

    if (projectEnum) {
        return `${streamRulesBase}
- **项目列举（topics 含 project）**：只列 hits 中 **projects/** 文档对应的项目名称与职责/技术栈；**禁止**把 experience/ 任职公司、职位、时间段当作项目名输出。`;
    }
    if (profile === "enumeration") {
        return `${streamRulesBase}
- **公司/任职列举（queryType=enumeration）**：须逐条列出 hits 中出现的**全部**公司/任职条目，每条含 excerpt 中的时间段与职位/角色（若有）；**禁止**只列前几条或概括成一句。`;
    }
    if (profile === "identity") {
        return `${streamRulesBase}
- **档案型（queryType=identity）**：直接给出字段值；只引 excerpt 原文；**禁止**按当前年份推算年龄。`;
    }
    if (profile === "external_link") {
        return `${streamRulesBase}
- **对外链接（queryType=external_link）**：只输出 hits excerpt 中出现的 URL/链接；须**逐条列出**全部可见链接。
- hits 提到项目/文档但 excerpt **无** \`http\` / \`github.com\`：说明「语料中该项目无公开仓库链接（可能为离线/内部副本）」，**禁止**输出其他项目的 URL。`;
    }
    return `${streamRulesBase}
- 年龄/「今年多大」：只引 excerpt 中的出生日期或原文年龄；禁止自行推算。
- 若有列举需求：逐条列名称，勿压缩为一句概括。`;
};

export const buildSubQuestionStreamPrompt = (
    profile: QueryProfile,
    topics: string[] = []
): string =>
    `你是 FamBrain「信息分析师」。本轮只回答**一条**子问题。

## 输入
JSON：userQuestion、language、hits、coverage、notes、queryType、topics（可选）。

## 任务
- 仅根据 hits excerpt 回答 userQuestion（注意 userQuestion/label 问的是项目还是公司/任职）。
- **直接输出回答正文**（Markdown 纯文本），不要 JSON、不要代码块、不要 chain-of-thought、不要重复 userQuestion 标题。
- 列举型 answer 用「- **名称**：摘要」列表；档案型用短段落或键值句。

## 规则
${subQuestionStreamRulesForProfile(profile, topics)}`;

/** 单问非流式 fallback / 短路径 */
export const subQuestionPrompt = `你是 FamBrain「信息分析师」。本轮只回答**一条**子问题（userQuestion 字段）。

## 输入
JSON：userQuestion、language、hits、coverage、notes、queryType（可选）。

## 任务
1. 仅根据 hits 中的 excerpt 回答**这一条**子问题。
2. 输出**唯一 JSON 对象**，无代码块、无 chain-of-thought。

## 规则
- hits 为空或 coverage 为 none：insufficientEvidence=true，说明知识库未覆盖此点。
- queryType=enumeration：须逐条列出 hits 中**全部**名称及时间段、职位。
- queryType=identity：只引 excerpt 原文；禁止推算年龄。
- 禁止编造 hits 中不存在的人名、公司、项目、日期。

## 输出 JSON
{
  "answer": string,
  "citations": [{ "path": string, "excerpt": string }],
  "confidence": number,
  "insufficientEvidence": boolean
}`;

/** @deprecated 使用 buildSubQuestionStreamPrompt(profile) */
export const subQuestionStreamPrompt = buildSubQuestionStreamPrompt("default");
