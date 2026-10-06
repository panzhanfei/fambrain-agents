/**
 * dev-all 用：0=连通，1=不可达，2=未配置 Redis。
 */
import net from "node:net";

const target = (): { host: string; port: number; password: string } | null => {
    const explicit = process.env.REDIS_URL?.trim();
    if (explicit) {
        const url = new URL(explicit);
        return {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: decodeURIComponent(url.password),
        };
    }
    const enabled = process.env.REDIS_ENABLED?.trim().toLowerCase();
    if (enabled !== "1" && enabled !== "true" && enabled !== "yes") return null;
    return {
        host: process.env.REDIS_HOST?.trim() || "127.0.0.1",
        port: Number(process.env.REDIS_PORT?.trim() || 6379),
        password: "",
    };
};

const redis = target();
if (!redis) process.exit(2);

const socket = net.connect({ host: redis.host, port: redis.port });
const timer = setTimeout(() => {
    socket.destroy();
    process.exit(1);
}, 2000);

socket.on("error", () => {
    clearTimeout(timer);
    process.exit(1);
});
socket.on("connect", () => {
    if (redis.password) socket.write(`AUTH ${redis.password}\r\n`);
    socket.write("PING\r\n");
});
socket.on("data", (chunk) => {
    clearTimeout(timer);
    socket.end();
    process.exit(chunk.toString().includes("PONG") ? 0 : 1);
});
