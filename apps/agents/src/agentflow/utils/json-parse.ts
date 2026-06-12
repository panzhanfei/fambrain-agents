export const parseJsonObject = <T>(text: string): T | null => {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const candidate = (fenced ?? trimmed).trim();
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start)
        return null;
    try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
    }
    catch {
        return null;
    }
};
