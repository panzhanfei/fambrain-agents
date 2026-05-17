import * as crypto from "node:crypto";

/** 失败后随机延迟，弱化凭认证响应的时间侧信道 */
export async function jitterAuthFailure(msMin = 180, msMax = 520): Promise<void> {
  const span = Math.max(msMax - msMin, 0);
  const extra = crypto.randomInt(0, span + 1);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, msMin + extra);
  });
}
