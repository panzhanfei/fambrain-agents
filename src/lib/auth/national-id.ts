/** 中国大陆 18 位居民身份证：结构与 ISO 7064 校验码（最后一位） */

const CHECK_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const;
/** 校验位余数 → 校验字符（GB 11643—1999 对应关系） */
const CHECK_CHARS = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

export function normalizeNationalId(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function expectedChecksumChar(first17Upper: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const d = first17Upper.charCodeAt(i) - 48;
    sum += d * CHECK_WEIGHTS[i];
  }
  const mod = sum % 11;
  return CHECK_CHARS[mod] ?? "?";
}

function isProbableAdministrativeCodes(code: string): boolean {
  return /^[1-9]\d{5}$/.test(code) && code !== "000000";
}

function isReasonableBirthYmd(y: number, m: number, d: number): boolean {
  const now = new Date();
  const thisYear = now.getFullYear();
  if (!(y >= 1850 && y <= thisYear)) return false;
  if (!(m >= 1 && m <= 12)) return false;
  if (!(d >= 1 && d <= 31)) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * 校验 18 位身份证号（校验位 + 生日合法 + 六位码形态）。
 */
export function isValidChineseResidentId(idNormalizedUpper: string): boolean {
  if (!/^[1-9]\d{16}[\dX]$/.test(idNormalizedUpper)) return false;

  const first17 = idNormalizedUpper.slice(0, 17);
  const checksum = idNormalizedUpper.slice(17);
  if (expectedChecksumChar(first17) !== checksum) return false;

  const admin = idNormalizedUpper.slice(0, 6);
  if (!isProbableAdministrativeCodes(admin)) return false;

  const ymdStr = idNormalizedUpper.slice(6, 14);
  const y = Number.parseInt(ymdStr.slice(0, 4), 10);
  const m = Number.parseInt(ymdStr.slice(4, 6), 10);
  const d = Number.parseInt(ymdStr.slice(6, 8), 10);

  return isReasonableBirthYmd(y, m, d);
}
