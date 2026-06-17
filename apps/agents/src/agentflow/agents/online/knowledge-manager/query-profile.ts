/**
 * KM-08 queryProfile：按 searchQuery + subTasks 规则推断问法类型。
 * Wave C 起 Intake 可传 queryType，见 resolveQueryProfile。
 */
export type QueryProfile = "identity" | "enumeration" | "tech" | "default";

const joinQueryText = (searchQuery: string, subTasks: string[]): string =>
    [searchQuery, ...subTasks].join(" ").toLowerCase();

/** 列举/穷举优先于 tech（含「几家公司分别用什么技术」类） */
const ENUMERATION_RE =
    /哪几|哪些|全部|所有|列举|有哪些|上过班|哪些公司|几家公司|全部公司|所有公司|全部经历|哪些经历|都有哪些/;

const IDENTITY_RE =
    /姓名|叫什么|名字|几岁|年龄|出生|职业|简历|个人档案|个人简介|联系方式|电话|邮箱|住址|哪里人|我叫什么|我是谁/;

const TECH_RE =
    /技术栈|框架|用什么|用的什么|数据库|架构|中间件|frontend|backend|devops|编程语言/i;

const TECH_TERMS_RE =
    /\b(react|vue|angular|typescript|javascript|python|java|go|docker|kubernetes|mysql|postgres|redis|vite|webpack|prisma)\b/i;

/** 规则推断 queryProfile（不调 LLM） */
export const inferQueryProfile = (
    searchQuery: string,
    subTasks: string[] = []
): QueryProfile => {
    const text = joinQueryText(searchQuery, subTasks);
    if (ENUMERATION_RE.test(text)) return "enumeration";
    if (IDENTITY_RE.test(text)) return "identity";
    if (TECH_RE.test(text) || TECH_TERMS_RE.test(text)) return "tech";
    return "default";
};

/** Intake queryType 优先；缺失时规则 fallback（QU-05） */
export const resolveQueryProfile = (
    searchQuery: string,
    subTasks: string[] = [],
    queryType?: QueryProfile | null
): QueryProfile => queryType ?? inferQueryProfile(searchQuery, subTasks);
