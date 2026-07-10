import { describe, expect, it } from "vitest";
import {
    isValidChineseResidentId,
    normalizeNationalId,
} from "./national-id";

describe("national-id", () => {
    it("normalizes spaces and case", () => {
        expect(normalizeNationalId(" 11010119900307758x ")).toBe(
            "11010119900307758X"
        );
    });

    it("rejects malformed ids", () => {
        expect(isValidChineseResidentId("12345")).toBe(false);
        expect(isValidChineseResidentId("000000199001011234")).toBe(false);
    });

    it("validates checksum and birth date", () => {
        expect(isValidChineseResidentId("11010119900307758X")).toBe(true);
        expect(isValidChineseResidentId("11010119900307758Y")).toBe(false);
    });
});
