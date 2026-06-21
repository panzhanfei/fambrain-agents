/**
 * QU-02 规则兜底：无上下文的多轮指代问法强制 clarify，避免 few-shot 误触发检索。
 * 有 history 实体线索时交给 Intake LLM 补全 searchQuery。
 */
import type { DbChatTurn } from "@fambrain/agent-types";
import type { IntakeRoutingDecision } from "./prompt";

/** 本轮仅指代、未自带实体 */
const VAGUE_REF_RE =
    /^(那个|这个|它|上述|刚才说的?|还有呢|然后呢)[^。！？]{0,24}(项目|公司|经历|阶段|平台)[呢吗？?]?$|^(那个|这个)(项目|公司|经历|阶段)[呢吗？?]?$/;

/** 上文或本轮出现可解析实体 */
const ENTITY_HINT_RE =
    /城管|城市管理|urban|E-HR|e-hr|奥卡云|aky|Sentinel|友谊时光|奖多多|云联|resume|个人信息|姓名|技术栈|React|UniApp|小程序|前端小组/i;

const joinHistoryText = (turns: DbChatTurn[]): string =>
    turns.map((t) => t.content).join("\n");

/** 除本轮 user 外，history 是否含可解析实体 */
export const hasCoreferenceContext = (history: DbChatTurn[]): boolean => {
    const prior = history.slice(0, -1);
    if (prior.length === 0) return false;
    return ENTITY_HINT_RE.test(joinHistoryText(prior));
};

export const isVagueReferentialQuestion = (question: string): boolean => {
    const q = question.trim();
    if (ENTITY_HINT_RE.test(q)) return false;
    return VAGUE_REF_RE.test(q) || /^那个项目呢[？?]?$/.test(q);
};

const DEFAULT_CLARIFY =
    "你指的是哪一段经历或哪个项目？例如城市管理平台、E-HR 或 Sentinel？";

/**
 * 单轮或无实体上文 + 指代问法 → clarify；
 * 有上文实体 → 保留 Intake 决策（含 retrieve）。
 */
export const applyIntakeCoreferenceGuard = (
    decision: IntakeRoutingDecision,
    history: DbChatTurn[]
): IntakeRoutingDecision => {
    const lastUser =
        [...history].reverse().find((t) => t.role === "user")?.content.trim() ??
        "";
    if (!isVagueReferentialQuestion(lastUser)) {
        return decision;
    }
    if (hasCoreferenceContext(history)) {
        return decision;
    }
    return {
        intent: "clarify",
        needsRetrieval: false,
        searchQuery: "",
        subTasks: [],
        topics: decision.topics.length > 0 ? decision.topics : ["project"],
        language: decision.language,
        confidence: Math.min(decision.confidence, 0.55),
        queryType: null,
        clarifyingQuestion: decision.clarifyingQuestion ?? DEFAULT_CLARIFY,
        briefReply: null,
        retrievalPlan: [],
    };
};
