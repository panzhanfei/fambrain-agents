import type { RoutedIntakeDecision } from "@/agentflow/agents/online/intake-coordinator/guards/interface";

/** 纯 list 路由：全部槽 executor=list_corpus，且无 km/tool/dag 步骤。 */
export const isPureListDecision = (
    decision: RoutedIntakeDecision
): boolean => {
    const slots = decision.compositeSlots ?? [];
    if (slots.length === 0) return false;
    if (!slots.every((s) => s.executor === "list_corpus")) return false;
    const pathPlan = decision.pathPlan;
    if (!pathPlan) return true;
    return (
        pathPlan.km.length === 0 &&
        pathPlan.tool.length === 0 &&
        pathPlan.dag.length === 0
    );
};
