import { getAgentsConfig } from "@fambrain/agent-config";

function visionModel(): string {
  const fromEnv = process.env.OLLAMA_MODEL_VISION?.trim();
  if (fromEnv) return fromEnv;
  return process.env.OLLAMA_MODEL?.trim() || getAgentsConfig().ollama.models.default;
}

type OllamaChatResponse = {
  message?: { content?: string };
  error?: string;
};

/** 用 Ollama 视觉模型从图片提取文字（Docling 触达级替代：本地 Ollama OCR）。 */
export async function parseImageWithOllamaOcr(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  const { chatEndpoint } = getAgentsConfig().ollama;
  const model = visionModel();
  const base64 = buffer.toString("base64");

  const res = await fetch(chatEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content: `请从图片「${fileName}」中提取全部可见文字，保留段落结构；只输出纯文本，不要解释。`,
          images: [base64],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text || `Ollama 图片 OCR 失败（HTTP ${res.status}），请确认 Ollama 已启动且模型 ${model} 支持 vision`
    );
  }

  const payload = (await res.json()) as OllamaChatResponse;
  if (payload.error) {
    throw new Error(payload.error);
  }

  const text = payload.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("Ollama 未返回图片文字，请设置 OLLAMA_MODEL_VISION 为支持 vision 的模型（如 llava）");
  }
  return text;
}
