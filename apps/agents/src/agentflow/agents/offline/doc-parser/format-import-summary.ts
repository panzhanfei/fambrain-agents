import type { DocParseBatchResult } from "./schema";

/** 面向用户的导入结果摘要（不含 userId / 目录结构）。 */
export const formatDocParseBatchSummary = (result: DocParseBatchResult): string => {
    const okCount = result.files.filter((f) => f.ok).length;
    const failedCount = result.files.length - okCount;
    const { personal, projects, experience } = result.categorySummary;
    let msg = `已导入 ${okCount} 个文件：个人 ${personal} · 项目 ${projects} · 经历 ${experience}`;
    if (result.indexed)
        msg += "，向量库已更新";
    if (failedCount > 0)
        msg += `（${failedCount} 个失败）`;
    return msg;
};
