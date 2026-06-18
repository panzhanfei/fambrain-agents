/**
 * dev-all 用：0=连通，1=不可达，2=未配置 Redis（走 memory fallback）
 */
import {
    isRedisConfigured,
    pingRedis,
    resetInfraConfigForTests,
} from "../packages/infra/src/index.ts";

resetInfraConfigForTests();

const main = async (): Promise<void> => {
    if (!isRedisConfigured()) {
        process.exit(2);
    }
    process.exit((await pingRedis()) ? 0 : 1);
};

main().catch(() => process.exit(1));
