import type { DbChatTurn } from "@fambrain/brain-types";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract/prompt";

/** 编排器 user_fact 分支路由（来自 Intake JSON，非问句 regex） */
export type UserFactRoute = {
    action: "remember" | "recall";
    /** 稳定键：Intake 产出，如 qq / wechat / dingtalk */
    factKey: string;
    /** 面向用户的字段名：微信号、钉钉号等 */
    label: string;
    value?: string;
};

/** Mem0 持久化结构（metadata + 可解析正文） */
export type UserFactRecord = {
    type: "user_fact";
    factKey: string;
    label: string;
    value: string;
};

export const normalizeFactKey = (raw: string): string =>
    raw
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_+-]/g, "")
        .slice(0, 64);

export const serializeUserFactRecord = (
    input: Omit<UserFactRecord, "type">
): string =>
    JSON.stringify({
        type: "user_fact",
        factKey: input.factKey,
        label: input.label,
        value: input.value,
    });

export const parseUserFactRecord = (text: string): UserFactRecord | null => {
    const t = text.trim();
    if (!t.startsWith("{")) return null;
    try {
        const o = JSON.parse(t) as Partial<UserFactRecord>;
        if (
            o.type === "user_fact" &&
            typeof o.factKey === "string" &&
            typeof o.label === "string" &&
            typeof o.value === "string" &&
            o.factKey.trim() &&
            o.value.trim()
        ) {
            return {
                type: "user_fact",
                factKey: o.factKey.trim(),
                label: o.label.trim(),
                value: o.value.trim(),
            };
        }
    }
    catch {
        /* 非 JSON 记忆行 */
    }
    return null;
};

export const validateFactValue = (value: string): string | null => {
    const v = value.trim();
    if (v.length < 1 || v.length > 200) return null;
    return v;
};

/** 按 factKey 校验召回值，过滤「码」等误切分 */
export const validateFactValueForKey = (
    factKey: string,
    value: string
): string | null => {
    const v = value.trim();
    if (!v) return null;
    if (factKey === "qq") {
        return /^\d{5,12}$/.test(v) ? v : null;
    }
    if (factKey === "phone") {
        return /^1[3-9]\d{9}$/.test(v) ? v : null;
    }
    if (factKey === "email") {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
    }
    if (factKey === "wechat") {
        return /^[a-zA-Z][\w-]{4,19}$/.test(v) ? v : null;
    }
    return validateFactValue(v);
};

const extractByFactKey = (factKey: string, text: string): string | null => {
    const t = text.trim();
    if (!t) return null;
    if (factKey === "qq") {
        const patterns = [
            /(?:qq|QQ)(?:号|号码)?\s*[:：是为]\s*(\d{5,12})/iu,
            /(?:qq|QQ)(?:号|号码)?(\d{5,12})/iu,
            /(\d{5,12})\s*(?:是|为)?\s*(?:我的\s*)?(?:qq|QQ)/iu,
        ];
        for (const re of patterns) {
            const m = t.match(re);
            if (m?.[1]) return validateFactValueForKey("qq", m[1]);
        }
        return null;
    }
    if (factKey === "phone") {
        const patterns = [
            /(?:手机|电话)(?:号|号码)?\s*[:：是为]\s*(1[3-9]\d{9})/u,
            /(1[3-9]\d{9})/u,
        ];
        for (const re of patterns) {
            const m = t.match(re);
            if (m?.[1]) return validateFactValueForKey("phone", m[1]);
        }
        return null;
    }
    if (factKey === "email") {
        const m = t.match(/([^\s@]+@[^\s@]+\.[^\s@]+)/u);
        if (m?.[1]) return validateFactValueForKey("email", m[1]);
        return null;
    }
    if (factKey === "wechat") {
        const patterns = [
            /(?:微信|wechat)(?:号|号码)?\s*[:：是为]\s*([a-zA-Z][\w-]{4,19})/iu,
            /(?:微信|wechat)(?:号|号码)?([a-zA-Z][\w-]{4,19})/iu,
        ];
        for (const re of patterns) {
            const m = t.match(re);
            if (m?.[1]) return validateFactValueForKey("wechat", m[1]);
        }
        return null;
    }
    return null;
};

/** 解析 Mem0 存储行「QQ号：734858469（字段 qq）」 */
const extractFromFieldMarker = (
    text: string,
    factKey: string
): string | null => {
    if (!new RegExp(`（字段\\s+${factKey}）`, "iu").test(text)) return null;
    const byKey = extractByFactKey(factKey, text);
    if (byKey) return byKey;
    const colon = text.match(/[:：]\s*([^（(，,。！？；;\s]+)/u);
    if (colon?.[1]) {
        return validateFactValueForKey(factKey, colon[1].trim());
    }
    return null;
};

/** Intake intent 是否为跨会话用户自述记忆（remember / recall） */
export const isUserFactIntent = (
    intent: IntakeRoutingDecision["intent"]
): boolean =>
    intent === "remember_user_fact" || intent === "recall_user_fact";

/** Intake 结构化 intent → userFact 路由（主路径） */
export const routeUserFactFromIntake = (
    decision: IntakeRoutingDecision
): UserFactRoute | null => {
    if (decision.intent === "remember_user_fact") {
        const factKey = normalizeFactKey(decision.userFactKey ?? "");
        if (!factKey) return null;
        const label = decision.userFactLabel?.trim() || factKey;
        const value = decision.userFactValue?.trim();
        return {
            action: "remember",
            factKey,
            label,
            ...(value ? { value } : {}),
        };
    }
    if (decision.intent === "recall_user_fact") {
        const factKey = normalizeFactKey(decision.userFactKey ?? "");
        if (!factKey) return null;
        const label = decision.userFactLabel?.trim() || factKey;
        return { action: "recall", factKey, label };
    }
    return null;
};

export const findUserFactValueInTexts = (
    texts: string[],
    factKey: string,
    label?: string
): string | null => {
    for (const line of texts) {
        const rec = parseUserFactRecord(line);
        if (rec && rec.factKey === factKey) {
            const v = validateFactValueForKey(factKey, rec.value);
            if (v) return v;
        }
    }
    for (const line of texts) {
        const byKey = extractByFactKey(factKey, line);
        if (byKey) return byKey;
        const byMarker = extractFromFieldMarker(line, factKey);
        if (byMarker) return byMarker;
    }
    if (label) {
        for (const line of texts) {
            const v = extractLooseValueAfterLabel(line, label, factKey);
            if (v) return validateFactValueForKey(factKey, v);
        }
    }
    return null;
};

export const findUserFactValueInMemoryBlock = (
    memoryBlock: string | null | undefined,
    factKey: string,
    label?: string
): string | null => {
    if (!memoryBlock?.trim()) return null;
    const lines = memoryBlock
        .split("\n")
        .map((l) => l.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean);
    return findUserFactValueInTexts(lines, factKey, label);
};

export const memoryBlockHasStructuredUserFacts = (
    memoryBlock: string | null | undefined
): boolean => {
    if (!memoryBlock?.trim()) return false;
    return (
        memoryBlock.includes('"type":"user_fact"') ||
        /（字段\s+[a-z0-9_+-]+）/iu.test(memoryBlock)
    );
};

/** remember 时 Intake 未带 value，尝试从本轮 user 句 / history 补全（通用：取 Intake 已填的 userFactValue 优先） */
export const coalesceRememberValue = (
    route: UserFactRoute,
    userQuestion: string,
    history: DbChatTurn[]
): string | null => {
    if (route.value) {
        return validateFactValue(route.value);
    }
    const fromQuestion =
        extractByFactKey(route.factKey, userQuestion) ??
        extractLooseValueAfterLabel(userQuestion, route.label, route.factKey);
    if (fromQuestion) return validateFactValueForKey(route.factKey, fromQuestion);
    for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i]!;
        if (turn.role !== "user") continue;
        const v =
            extractByFactKey(route.factKey, turn.content) ??
            extractLooseValueAfterLabel(turn.content, route.label, route.factKey);
        if (v) return validateFactValueForKey(route.factKey, v);
    }
    return null;
};

/** 「标签 + ：/是/为 + 值」；label 为「QQ号」时允许匹配「QQ号码是…」 */
const extractLooseValueAfterLabel = (
    text: string,
    label: string,
    factKey?: string
): string | null => {
    const q = text.trim();
    if (!q) return null;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const labelStem = escaped.replace(/号$/u, "");
    const valueToken = `([^\\s，,。！？；;（）]+)`;
    const patterns = [
        new RegExp(
            `${labelStem}(?:号|号码)?\\s*[:：]\\s*${valueToken}`,
            "iu"
        ),
        new RegExp(
            `${labelStem}(?:号|号码)?\\s*(?:是|为)\\s*${valueToken}`,
            "iu"
        ),
        new RegExp(
            `(?:是|为)\\s*${valueToken}\\s*[,，]?\\s*${labelStem}(?:号|号码)?`,
            "iu"
        ),
    ];
    for (const re of patterns) {
        const m = q.match(re);
        if (m?.[1]?.trim()) {
            const raw = m[1].trim();
            if (factKey) {
                const validated = validateFactValueForKey(factKey, raw);
                if (validated) return validated;
                continue;
            }
            if (raw.length >= 2) return raw;
        }
    }
    return null;
};

export const buildRememberConfirmAnswer = (
    label: string,
    value: string,
    language: "zh" | "en" | "mixed"
): string =>
    language === "en"
        ? `Got it — I've saved your ${label}: ${value}.`
        : `好的，已记住您的${label}：${value}。`;

export const buildRememberMissingValueAnswer = (
    label: string,
    language: "zh" | "en" | "mixed"
): string =>
    language === "en"
        ? `Please tell me your ${label} so I can save it.`
        : `请告诉我您的${label}，我再帮您记住。`;

export const buildRecallAnswer = (
    label: string,
    value: string,
    language: "zh" | "en" | "mixed"
): string =>
    language === "en"
        ? `Your ${label} on record is ${value}.`
        : `您记录的${label}是 ${value}。`;

export const buildRecallMissingAnswer = (
    label: string,
    language: "zh" | "en" | "mixed"
): string =>
    language === "en"
        ? `I don't have your ${label} saved yet. You can say e.g. "Remember my ${label} is …".`
        : `尚未记录您的${label}。您可以说「我的${label}是……，请帮我记住」。`;
