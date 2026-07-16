/**
 * KM-08 queryProfile：Intake queryType 为单一意图来源（Wave C / QU-06）。
 *
 * @deprecated `inferQueryProfile` 仅供脚本/诊断直调 KM（queryType 未传）。
 * Pipeline / guard / composite 主路径禁止调用；须传显式 queryType。
 */
export type QueryProfile =
    | "identity"
    | "enumeration"
    | "tech"
    | "external_link"
    | "default";

const joinQueryText = (searchQuery: string, subTasks: string[]): string =>
    [searchQuery, ...subTasks].join(" ").toLowerCase();

/** @deprecated 仅脚本；勿在 pipeline 引用 */
const EXTERNAL_LINK_RE =
    /github|git\s*hub|githup|仓库地址|对外链接|\burl\b|线上地址|线上预览|开源.*(?:链接|地址)|(?:链接|地址).*(?:github|仓库|线上)/i;

/** @deprecated 仅脚本；勿在 pipeline 引用 */
const ENUMERATION_RE =
    /哪几|哪些|那些|全部|所有|列举|有哪些|上过班|哪些公司|几家公司|全部公司|所有公司|全部经历|哪些经历|都有哪些|做过.*项目|项目经历/;

/** @deprecated 仅脚本；勿在 pipeline 引用 */
const IDENTITY_RE =
    /姓名|叫什么|名字|几岁|多大|年龄|出生|职业|简历|个人档案|个人简介|联系方式|电话|邮箱|住址|哪里人|我叫什么|我是谁|学历|行业|从事|近两年|最近.*年|在干什么|空窗|自主学习|职业阶段|时间段/;

/** @deprecated 仅脚本；勿在 pipeline 引用 */
const TECH_RE =
    /技术栈|框架|用什么|用的什么|数据库|架构|中间件|frontend|backend|devops|编程语言/i;

/** @deprecated 仅脚本；勿在 pipeline 引用 */
const TECH_TERMS_RE =
    /\b(react|vue|angular|typescript|javascript|python|java|go|docker|kubernetes|mysql|postgres|redis|vite|webpack|prisma)\b/i;

/**
 * @deprecated 规则推断 queryProfile（不调 LLM）。仅脚本/诊断直调 KM。
 * Pipeline 主路径以 Intake queryType 为准，禁止调用本函数。
 */
export const inferQueryProfile = (
    searchQuery: string,
    subTasks: string[] = []
): QueryProfile => {
    const text = joinQueryText(searchQuery, subTasks);
    if (EXTERNAL_LINK_RE.test(text)) return "external_link";
    if (ENUMERATION_RE.test(text)) return "enumeration";
    if (IDENTITY_RE.test(text)) return "identity";
    if (TECH_RE.test(text) || TECH_TERMS_RE.test(text)) return "tech";
    return "default";
};

/**
 * QU-05/06：Intake queryType 优先。
 * - 有明确 queryType → 直接用；
 * - queryType === null（Intake 未给类型）→ default，不再二次规则推断；
 * - queryType === undefined（脚本直调 KM）→ inferQueryProfile fallback。
 */
export const resolveQueryProfile = (
    searchQuery: string,
    subTasks: string[] = [],
    queryType?: QueryProfile | null
): QueryProfile => {
    if (queryType !== undefined && queryType !== null) {
        return queryType;
    }
    if (queryType === null) {
        return "default";
    }
    return inferQueryProfile(searchQuery, subTasks);
};
