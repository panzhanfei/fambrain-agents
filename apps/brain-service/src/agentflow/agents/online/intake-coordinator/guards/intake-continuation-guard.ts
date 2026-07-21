/**
 * 续问 guard（档 B）：恒 noop。
 * 指代消解归 Intake LLM + intake-node merge retry；代码不改写 searchQuery / intent。
 */
import type { DbChatTurn } from "@fambrain/brain-types";
import type { IntakeRoutingDecision } from "@/agentflow/agents/online/intake-coordinator/contract";

export type IntakeContinuationGuardReason = "noop";

export const applyIntakeContinuationGuard = (
  decision: IntakeRoutingDecision,
  _userQuestion: string,
  _history: DbChatTurn[]
): IntakeRoutingDecision & {
  continuationGuardReason?: IntakeContinuationGuardReason;
} => ({ ...decision, continuationGuardReason: "noop" });
