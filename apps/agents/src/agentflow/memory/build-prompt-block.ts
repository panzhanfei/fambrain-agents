export function buildMemoryPromptBlock(input: {
  sessionSummary: string | null;
  userMemories: string[];
}): string | null {
  const parts: string[] = [];

  if (input.sessionSummary) {
    parts.push(`### 本会话摘要（LangMem）\n${input.sessionSummary}`);
  }

  if (input.userMemories.length > 0) {
    const lines = input.userMemories.map((m) => `- ${m}`).join("\n");
    parts.push(`### 用户长期记忆（Mem0）\n${lines}`);
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}
