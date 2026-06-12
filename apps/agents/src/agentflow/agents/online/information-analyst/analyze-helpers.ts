import { dedupeCitations } from "@/agentflow/agents/online/content-organizer";
import type { Citation, InformationAnalystInput, InformationAnalystResult, } from "./prompt";
import { parseAnalystResult } from "./schema";
export { parseAnalystResult as normalizeAnalystResult };
export const buildFallbackAnswer = (input: InformationAnalystInput): InformationAnalystResult => {
    const { userQuestion, hits, coverage, notes, language } = input;
    if (hits.length === 0 || coverage === "none") {
        const answer = language === "en"
            ? "No relevant content was found in the personal knowledge base for your question. Try naming a specific company or project, or add the matching doc under src/doc first."
            : "当前个人知识库中没有检索到与你问题直接相关的内容。你可以补充具体公司、项目名称，或先在 src/doc/users/<语料归属账号>/corpus 下完善对应文档后再问。";
        return {
            answer,
            citations: [],
            confidence: 0.9,
            insufficientEvidence: true,
        };
    }
    const citations: Citation[] = dedupeCitations(hits.map((h) => ({
        path: h.path,
        excerpt: h.excerpt,
    })));
    const bullets = hits.map((h) => `- **${h.title}**：${h.excerpt}`);
    let answer = language === "en"
        ? `Regarding "${userQuestion}", from the knowledge base:\n\n${bullets.join("\n")}`
        : `关于「${userQuestion}」，根据知识库摘录：\n\n${bullets.join("\n")}`;
    if (coverage === "partial") {
        answer +=
            language === "en"
                ? "\n\n(Some details may be missing from the retrieved excerpts.)"
                : "\n\n（部分细节可能未在检索片段中覆盖。）";
    }
    if (notes) {
        answer += language === "en" ? `\n\nNote: ${notes}` : `\n\n备注：${notes}`;
    }
    return {
        answer,
        citations,
        confidence: coverage === "sufficient" ? 0.75 : 0.6,
        insufficientEvidence: false,
    };
};
