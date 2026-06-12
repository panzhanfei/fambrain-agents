import * as crypto from "node:crypto";
export const jitterAuthFailure = async (msMin = 180, msMax = 520): Promise<void> => {
    const span = Math.max(msMax - msMin, 0);
    const extra = crypto.randomInt(0, span + 1);
    await new Promise<void>((resolve) => {
        setTimeout(resolve, msMin + extra);
    });
};
