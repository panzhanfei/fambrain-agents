import { z } from "zod";
/** 修剪空白；空串视为 null */
export const nullableTrimmedString = z
    .union([z.string(), z.null()])
    .transform((v) => {
    if (v == null)
        return null;
    const t = String(v).trim();
    return t.length > 0 ? t : null;
});
/** 非空字符串数组（丢弃空白项） */
export const nonEmptyStringArray = z
    .array(z.coerce.string())
    .transform((items) => items.map((s) => String(s).trim()).filter((s) => s.length > 0));
/** 0–1 置信度 */
export const unitInterval = z.coerce
    .number()
    .finite()
    .transform((n) => Math.min(1, Math.max(0, n)))
    .catch(0);
