import { describe, expect, it } from "vitest";
import type { DbChatTurn } from "@fambrain/brain-types";
import {
  buildMergedCoreferenceQuestion,
  normalizeIntakeUtterance,
  rewriteLastUserTurn,
  shouldRetryCoreferenceMerge,
  shouldShortCircuitIncompleteUtterance,
  surfaceForSingleCharSignal,
} from "@/agentflow/agents/online/intake-coordinator";

describe("normalizeIntakeUtterance", () => {
  it("collapses consecutive identical code points", () => {
    expect(normalizeIntakeUtterance("呢呢呢？？？")).toBe("呢？");
    expect(normalizeIntakeUtterance("好好好")).toBe("好");
    expect(normalizeIntakeUtterance("  aaa  ")).toBe("a");
  });

  it("does not collapse distinct characters", () => {
    expect(normalizeIntakeUtterance("那个项目呢？")).toBe("那个项目呢？");
  });
});

describe("shouldRetryCoreferenceMerge", () => {
  const historyWithPrior: DbChatTurn[] = [
    { role: "user", content: "城管平台用了什么技术" },
    { role: "assistant", content: "城市管理平台使用 React。" },
    { role: "user", content: "那个项目呢？" },
  ];

  it("retries when coreference is unresolved and prior exists", () => {
    const r = shouldRetryCoreferenceMerge(
      { intent: "clarify", coreference: "unresolved" },
      "那个项目呢？",
      historyWithPrior
    );
    expect(r.retry).toBe(true);
    expect(r.prior).toBe("城管平台用了什么技术");
    expect(r.mergedQuestion).toBe("城管平台用了什么技术；那个项目呢？");
  });

  it("does not retry when peek is null (prose)", () => {
    const r = shouldRetryCoreferenceMerge(null, "那个项目呢？", historyWithPrior);
    expect(r.retry).toBe(false);
  });

  it("retries clarify + short continuation when coreference omitted", () => {
    const r = shouldRetryCoreferenceMerge(
      { intent: "clarify", coreference: "none" },
      "那个项目呢？",
      historyWithPrior
    );
    expect(r.retry).toBe(true);
  });

  it("does not retry when already resolved without enumeration", () => {
    const r = shouldRetryCoreferenceMerge(
      { intent: "retrieve_and_answer", coreference: "resolved" },
      "那个项目呢？",
      historyWithPrior
    );
    expect(r.retry).toBe(false);
  });

  it("retries short entity-swap when retrieve wrongly uses enumeration", () => {
    const history: DbChatTurn[] = [
      { role: "user", content: "我那一年入职奥卡云的？" },
      {
        role: "assistant",
        content: "你于 2021 年 6 月入职西安奥卡云科技有限公司。",
      },
      { role: "user", content: "云联智慧呢" },
    ];
    const r = shouldRetryCoreferenceMerge(
      {
        intent: "retrieve_and_answer",
        coreference: "resolved",
        queryType: "enumeration",
        retrievalPlan: [
          {
            label: "云联智慧经历",
            searchQuery: "工作经历 云联智慧",
            queryType: "enumeration",
            topics: ["experience"],
          },
        ],
      },
      "云联智慧呢",
      history
    );
    expect(r.retry).toBe(true);
    expect(r.mergedQuestion).toBe("我那一年入职奥卡云的？；云联智慧呢");
  });

  it("retries when short continuation entity is missing from plan", () => {
    const history: DbChatTurn[] = [
      { role: "user", content: "我那一年入职奥卡云的？" },
      {
        role: "assistant",
        content: "你于 2021 年 6 月入职西安奥卡云科技有限公司。",
      },
      { role: "user", content: "云联智慧呢" },
    ];
    const r = shouldRetryCoreferenceMerge(
      {
        intent: "retrieve_and_answer",
        coreference: "resolved",
        queryType: "default",
        searchQuery: "奥卡云 入职 年份",
        retrievalPlan: [
          {
            label: "奥卡云入职年份",
            searchQuery: "奥卡云 入职 年份",
            queryType: "default",
            topics: ["experience"],
          },
        ],
      },
      "云联智慧呢",
      history
    );
    expect(r.retry).toBe(true);
    expect(r.mergedQuestion).toContain("云联智慧呢");
  });

  it("does not retry when short continuation entity already in plan", () => {
    const history: DbChatTurn[] = [
      { role: "user", content: "我那一年入职奥卡云的？" },
      {
        role: "assistant",
        content: "你于 2021 年 6 月入职西安奥卡云科技有限公司。",
      },
      { role: "user", content: "云联智慧呢" },
    ];
    const r = shouldRetryCoreferenceMerge(
      {
        intent: "retrieve_and_answer",
        coreference: "resolved",
        queryType: "default",
        searchQuery: "云联智慧 入职 年份",
        retrievalPlan: [
          {
            label: "云联智慧入职年份",
            searchQuery: "云联智慧 入职 年份 哪一年",
            queryType: "default",
            topics: ["experience"],
          },
        ],
      },
      "云联智慧呢",
      history
    );
    expect(r.retry).toBe(false);
  });

  it("does not retry long standalone questions on clarify", () => {
    const history: DbChatTurn[] = [
      { role: "user", content: "城管平台用了什么技术" },
      { role: "assistant", content: "React" },
      { role: "user", content: "友谊时光阶段我负责什么前端工程化建设？" },
    ];
    const q = "友谊时光阶段我负责什么前端工程化建设？";
    const r = shouldRetryCoreferenceMerge(
      { intent: "clarify", coreference: "none" },
      q,
      history
    );
    expect(r.retry).toBe(false);
  });

  it("does not retry without prior", () => {
    const r = shouldRetryCoreferenceMerge(
      { intent: "clarify", coreference: "unresolved" },
      "那个项目呢？",
      [{ role: "user", content: "那个项目呢？" }]
    );
    expect(r.retry).toBe(false);
  });
});

describe("buildMergedCoreferenceQuestion", () => {
  it("joins with Chinese semicolon", () => {
    expect(buildMergedCoreferenceQuestion("上轮", "本轮")).toBe("上轮；本轮");
  });
});

describe("shouldShortCircuitIncompleteUtterance", () => {
  it("short-circuits ack and lone punct without history", () => {
    expect(shouldShortCircuitIncompleteUtterance("嗯", [])).toBe(true);
    expect(shouldShortCircuitIncompleteUtterance("？", [])).toBe(true);
  });

  it("short-circuits repeated ack/punct spam after normalize", () => {
    expect(shouldShortCircuitIncompleteUtterance("嗯嗯嗯！！！", [])).toBe(true);
    expect(surfaceForSingleCharSignal("呢呢呢？？")).toBe("呢");
    expect(shouldShortCircuitIncompleteUtterance("呢呢呢？？", [])).toBe(true);
  });

  it("does not short-circuit continuable single char when prior exists", () => {
    const history: DbChatTurn[] = [
      { role: "user", content: "城管平台用了什么技术" },
      { role: "assistant", content: "城市管理平台使用 React TypeScript。" },
      { role: "user", content: "呢" },
    ];
    expect(shouldShortCircuitIncompleteUtterance("呢", history)).toBe(false);
    expect(shouldShortCircuitIncompleteUtterance("呢呢呢", history)).toBe(
      false
    );
  });
});

describe("rewriteLastUserTurn", () => {
  it("rewrites only the last user turn", () => {
    const history: DbChatTurn[] = [
      { role: "user", content: "上轮" },
      { role: "assistant", content: "答" },
      { role: "user", content: "呢" },
    ];
    const out = rewriteLastUserTurn(history, "上轮；呢");
    expect(out[0]?.content).toBe("上轮");
    expect(out[2]?.content).toBe("上轮；呢");
  });
});
