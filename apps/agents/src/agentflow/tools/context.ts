/** LangChain Tool 调用时的 corpus / actor 上下文（由编排层或 verify 脚本注入） */
export type FambrainToolContext = {
    corpusUserId: string;
    actorUserId: string;
};

let activeContext: FambrainToolContext | null = null;

export const getToolContext = (): FambrainToolContext => {
    if (!activeContext) {
        throw new Error(
            "Fambrain tool context 未设置；请在 runWithToolContext 内调用 tool.invoke"
        );
    }
    return activeContext;
};

export const runWithToolContext = async <T>(
    context: FambrainToolContext,
    fn: () => Promise<T>
): Promise<T> => {
    const prev = activeContext;
    activeContext = context;
    try {
        return await fn();
    } finally {
        activeContext = prev;
    }
};
