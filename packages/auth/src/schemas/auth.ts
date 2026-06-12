import { isValidChineseResidentId, normalizeNationalId, } from "../national-id";
import { z } from "zod";
export const nationalIdSchema = z
    .string()
    .transform((s) => normalizeNationalId(s))
    .pipe(z
    .string()
    .length(18, "身份证号须为 18 位")
    .refine((n) => isValidChineseResidentId(n), "身份证号不合法（校验位或出生日期有误）"));
export const registerBodySchema = z.object({
    username: z.string().trim().min(2, "用户名至少 2 个字符").max(32, "用户名过长"),
    password: z.string().min(8, "密码至少 8 位"),
    nationalId: nationalIdSchema,
    displayName: z.string().trim().min(1, "请填写称呼").max(64),
    relationToPrincipal: z.string().trim().min(1, "请填写与本人的关系").max(64),
});
export const loginBodySchema = z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1),
});
