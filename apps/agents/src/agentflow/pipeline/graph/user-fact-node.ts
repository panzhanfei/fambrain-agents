import { logAgentIn, logAgentOut } from "@fambrain/agent-shared/agent-log";
import {
    addStructuredUserFact,
    searchUserFactMemories,
} from "@fambrain/agent-memory";
import type { PipelineGraphState } from "./state";
import {
    buildRecallAnswer,
    buildRecallMissingAnswer,
    buildRememberConfirmAnswer,
    buildRememberMissingValueAnswer,
    coalesceRememberValue,
    findUserFactValueInMemoryBlock,
    findUserFactValueInTexts,
    validateFactValue,
} from "@/agentflow/agents/online/intake-coordinator/user-fact";

const resolveRecallValue = async (
    state: PipelineGraphState
): Promise<string | null> => {
    const route = state.decision?.userFact;
    if (!route) return null;

    const fromBlock = findUserFactValueInMemoryBlock(
        state.memoryBlock,
        route.factKey,
        route.label
    );
    if (fromBlock) return fromBlock;

    if (state.userMemories.length > 0) {
        const fromLoaded = findUserFactValueInTexts(
            state.userMemories,
            route.factKey,
            route.label
        );
        if (fromLoaded) return fromLoaded;
    }

    const actorUserId = state.context.actorUserId;
    if (actorUserId) {
        const searched = await searchUserFactMemories(
            actorUserId,
            route.factKey,
            route.label,
            state.userQuestion
        );
        const fromSearch = findUserFactValueInTexts(
            searched,
            route.factKey,
            route.label
        );
        if (fromSearch) return fromSearch;
    }

    return null;
};

export const userFactNode = async (
    state: PipelineGraphState
): Promise<Partial<PipelineGraphState>> => {
    const userFact = state.decision?.userFact;
    const language = state.decision?.language ?? "zh";
    if (!userFact) {
        return {
            answer: "（未能处理用户记忆请求，请稍后重试）",
            exitEarly: true,
        };
    }

    logAgentIn("UserFact", "进入", {
        action: userFact.action,
        factKey: userFact.factKey,
        label: userFact.label,
        hasValue: Boolean(userFact.value),
        actorUserId: state.context.actorUserId,
    });

    try {
        if (userFact.action === "remember") {
            const raw =
                coalesceRememberValue(
                    userFact,
                    state.userQuestion,
                    state.history
                ) ?? null;
            const value = raw ? validateFactValue(raw) : null;

            if (!value) {
                const answer = buildRememberMissingValueAnswer(
                    userFact.label,
                    language
                );
                logAgentOut("UserFact", "出去", {
                    action: "remember",
                    factKey: userFact.factKey,
                    ok: false,
                    reason: "missing_value",
                });
                return { answer, exitEarly: true };
            }

            await addStructuredUserFact({
                userId: state.context.actorUserId,
                factKey: userFact.factKey,
                label: userFact.label,
                value,
            });

            const answer = buildRememberConfirmAnswer(
                userFact.label,
                value,
                language
            );
            logAgentOut("UserFact", "出去", {
                action: "remember",
                factKey: userFact.factKey,
                ok: true,
                valuePreview: value,
            });
            return { answer, exitEarly: true };
        }

        const value = await resolveRecallValue(state);
        const answer = value
            ? buildRecallAnswer(userFact.label, value, language)
            : buildRecallMissingAnswer(userFact.label, language);

        logAgentOut("UserFact", "出去", {
            action: "recall",
            factKey: userFact.factKey,
            ok: Boolean(value),
            valuePreview: value ?? null,
        });
        return { answer, exitEarly: true };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logAgentOut("UserFact", "出去", {
            action: userFact.action,
            factKey: userFact.factKey,
            ok: false,
            error: message,
        });
        return {
            answer:
                language === "en"
                    ? "Failed to access saved contact info. Please try again."
                    : "读取或保存联系方式时出错，请稍后重试。",
            exitEarly: true,
            error: message,
        };
    }
};
