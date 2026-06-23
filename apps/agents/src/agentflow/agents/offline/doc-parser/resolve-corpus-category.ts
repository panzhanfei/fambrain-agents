import { SCAN_FOLDERS, type CorpusCategory } from "@fambrain/corpus";

export type ResolveCorpusCategoryInput = {
    fileName: string;
    relativePath?: string;
    title?: string;
    textSnippet?: string;
};

const PATH_CATEGORY = /(?:^|[\\/])(personal|projects|experience)(?:[\\/]|$)/i;

const PROJECT_HINTS =
    /项目|平台|系统|架构|技术方案|产品|模块|服务|控制台|后台|admin|console|platform|project|sdk|api|prd|spec/i;
const EXPERIENCE_HINTS =
    /工作经历|任职|在职|公司|雇主|岗位|职责|employment|experience|career|resume|cv|20\d{2}\s*[.\-/年~至到]\s*(20\d{2}|至今|现在)/i;
const PERSONAL_HINTS = /简历|履历|个人|简介|about|profile|personal|自我介绍/i;

const categoryFromPath = (relativePath?: string): CorpusCategory | undefined => {
    if (!relativePath?.trim())
        return undefined;
    const normalized = relativePath.replace(/\\/g, "/");
    const match = normalized.match(PATH_CATEGORY);
    if (!match)
        return undefined;
    const raw = match[1].toLowerCase();
    if (SCAN_FOLDERS.includes(raw as CorpusCategory))
        return raw as CorpusCategory;
    return undefined;
};

const scoreCategory = (haystack: string): CorpusCategory => {
    const projectScore =
        (PROJECT_HINTS.test(haystack) ? 2 : 0) +
        (/(?:^|[\s/])projects?(?:[\s/]|$)/i.test(haystack) ? 1 : 0);
    const experienceScore =
        (EXPERIENCE_HINTS.test(haystack) ? 2 : 0) +
        (/(?:^|[\s/])experience(?:[\s/]|$)/i.test(haystack) ? 1 : 0);
    const personalScore =
        (PERSONAL_HINTS.test(haystack) ? 2 : 0) +
        (/(?:^|[\s/])personal(?:[\s/]|$)/i.test(haystack) ? 1 : 0);
    if (projectScore > experienceScore && projectScore > personalScore)
        return "projects";
    if (experienceScore > projectScore && experienceScore > personalScore)
        return "experience";
    if (personalScore > 0)
        return "personal";
    return "personal";
};

/** 按路径 / 文件名 / 标题 / 正文片段推断语料分类；无法判断时默认 personal。 */
export const resolveCorpusCategory = (input: ResolveCorpusCategoryInput): CorpusCategory => {
    const fromPath = categoryFromPath(input.relativePath);
    if (fromPath)
        return fromPath;
    const haystack = [
        input.fileName,
        input.relativePath ?? "",
        input.title ?? "",
        input.textSnippet?.slice(0, 800) ?? "",
    ]
        .join(" ")
        .trim();
    if (!haystack)
        return "personal";
    return scoreCategory(haystack);
};
