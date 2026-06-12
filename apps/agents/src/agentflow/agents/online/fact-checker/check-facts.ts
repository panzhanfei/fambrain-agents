/**
 * FactChecker 主流程：LLM 审查 + 规则兜底 + Zod 规范化。
 *
 * 在 Pipeline 中的位置：KnowledgeManager 检索之后、ContentOrganizer 之前。
 * 编排器读取返回的 `passed` / `refinedSearchQuery`，决定是否打回再检索（最多 1 次）。
 *
 * 处理链路：
 *   1. 预计算规则兜底（LLM 失败或 JSON 无效时使用）
 *   2. 调用 Ollama 单次 invoke，输入为 FactCheckerInput JSON
 *   3. 解析模型 JSON → Zod 校验 → 合并 retryCount 强制放行策略
 *   4. 若 LLM 打回但 refined 与旧 searchQuery 相同，用规则层补改写
 */

import {
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";

import { getAgentsConfig } from "@fambrain/agent-config";
import {
  logAgentIn,
  logAgentOut,
  logAgentStep,
} from "@fambrain/agent-shared/agent-log";

import { parseJsonObject, textFromResponse } from "@/agentflow/utils";

import {
  buildRuleBasedFactCheck,
  normalizeFactCheckerResult,
} from "./check-helpers";
import {
  prompt,
  type FactCheckerInput,
  type FactCheckerResult,
} from "./prompt";

const { ollama } = getAgentsConfig();

/** 与 IntakeCoordinator 共用同一 Ollama 模型，P0 减少模型配置项 */
const llm = new ChatOllama({
  baseUrl: ollama.baseUrl,
  model: ollama.models.intakeCoordinator,
});

/**
 * 将 hits 压缩为日志友好结构，避免 excerpt 全文刷屏。
 * 仅用于 logAgentIn，不影响实际核查逻辑。
 */
const summarizeHits = (input: FactCheckerInput) => {
  return input.hits.map((h, i) => ({
    index: i,
    path: h.path,
    title: h.title,
    relevance: h.relevance,
    excerptPreview: h.excerpt.slice(0, 160),
  }));
};

/**
 * 事实核查主入口。
 *
 * @param input - 编排器注入：用户问题、Intake 路由、KM 产出的 hits/coverage、retryCount
 * @returns passed=false 且 retryCount=0 时，编排器会用 refinedSearchQuery 再打回 KM 检索一次
 *
 * 三层保障：
 * - LLM：语义判断证据是否足够、能否改写检索词
 * - 规则（buildRuleBasedFactCheck）：Ollama 不可用或解析失败时的确定性兜底
 * - Zod（normalizeFactCheckerResult）：字段校验 + retryCount≥1 强制放行
 */
export const completeFactCheck = async (
  input: FactCheckerInput
): Promise<FactCheckerResult> => {
  // ── 步骤 1：记录完整输入，便于对照 KM 产出与 Intake 路由 ──
  logAgentIn("FactChecker", "步骤1 · 完整输入", {
    userQuestion: input.userQuestion,
    intent: input.intent,
    needsRetrieval: input.needsRetrieval,
    searchQuery: input.searchQuery,
    subTasks: input.subTasks,
    topics: input.topics,
    language: input.language,
    coverage: input.coverage,
    notes: input.notes,
    retryCount: input.retryCount,
    hitCount: input.hits.length,
    hits: summarizeHits(input),
  });

  // ── 步骤 2：先算规则兜底，LLM 任意环节失败都能立即回退 ──
  logAgentStep("FactChecker", "步骤2 · 预计算规则兜底", {
    model: ollama.models.intakeCoordinator,
    baseUrl: ollama.baseUrl,
  });
  const fallback = buildRuleBasedFactCheck(input);
  logAgentStep("FactChecker", "步骤2 · 规则兜底结果", fallback);

  try {
    // ── 步骤 3：单次 invoke，System=核查指令，Human=FactCheckerInput JSON ──
    const humanPayload = JSON.stringify(input, null, 2);
    logAgentStep("FactChecker", "步骤3 · 调用 LLM", {
      model: ollama.models.intakeCoordinator,
      systemPromptChars: prompt.length,
      humanMessageChars: humanPayload.length,
    });

    const ai = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(humanPayload),
    ]);

    // ── 步骤 4：提取模型原始文本（可能含 ```json 代码块）──
    const text = textFromResponse(ai.content);
    logAgentStep("FactChecker", "步骤4 · LLM 原始回复", {
      responseChars: text.length,
      rawText: text,
    });

    // ── 步骤 5：从回复中抠出 JSON 对象 ──
    const parsed = parseJsonObject<FactCheckerResult>(text);
    logAgentStep("FactChecker", "步骤5 · JSON 解析", {
      parseOk: parsed !== null,
      parsed,
    });

    // ── 步骤 6：Zod 校验；parsed=null 时整包回退为 fallback ──
    const beforeNormalize = parsed;
    const result = normalizeFactCheckerResult(
      parsed,
      fallback,
      input.retryCount
    );
    logAgentStep("FactChecker", "步骤6 · Zod 规范化后", {
      usedFallback: beforeNormalize === null,
      llmPassed: beforeNormalize?.passed,
      finalPassed: result.passed,
      changedFromLlm:
        beforeNormalize !== null &&
        (beforeNormalize.passed !== result.passed ||
          beforeNormalize.evidenceScore !== result.evidenceScore ||
          beforeNormalize.refinedSearchQuery !== result.refinedSearchQuery),
      result,
    });

    // ── 步骤 7：防无效打回 — LLM 给的 refined 与当前 searchQuery 相同时无法真正重搜 ──
    if (
      !result.passed &&
      result.refinedSearchQuery &&
      result.refinedSearchQuery.trim() === input.searchQuery.trim()
    ) {
      logAgentStep(
        "FactChecker",
        "步骤7 · refined 与旧 query 相同，规则补改写",
        {
          unchangedQuery: input.searchQuery,
          llmRefined: result.refinedSearchQuery,
        }
      );
      const refined = buildRuleBasedFactCheck(input);
      if (refined.refinedSearchQuery) {
        logAgentStep("FactChecker", "步骤7 · 规则补改写结果", {
          before: result.refinedSearchQuery,
          after: refined.refinedSearchQuery,
        });
        result.refinedSearchQuery = refined.refinedSearchQuery;
      }
    }

    // ── 步骤 8：输出最终判定；编排器据此更新 checkerPassed / decision.searchQuery ──
    logAgentStep("FactChecker", "步骤8 · 最终判定", {
      passed: result.passed,
      evidenceScore: result.evidenceScore,
      willRetryRetrieval:
        !result.passed &&
        result.refinedSearchQuery !== null &&
        input.retryCount < 1,
      refinedSearchQuery: result.refinedSearchQuery,
      checkerNotes: result.checkerNotes,
      issues: result.issues,
    });
    logAgentOut("FactChecker", "步骤9 · 核查完成", result);
    return result;
  } catch (e) {
    // Ollama 网络/模型异常：不再抛错，直接返回步骤 2 已算好的规则结果
    const errorMessage = e instanceof Error ? e.message : String(e);
    logAgentStep("FactChecker", "异常 · LLM 调用失败，使用规则兜底", {
      error: errorMessage,
      fallback,
    });
    logAgentOut("FactChecker", "核查结果（LLM 失败，规则回退）", {
      error: errorMessage,
      result: fallback,
    });
    return fallback;
  }
};
