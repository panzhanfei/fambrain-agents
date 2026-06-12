export const getRequestIpKey = (headers: Headers): string => {
    if (process.env.TRUST_PROXY_HEADERS === "true") {
        const xff = headers.get("x-forwarded-for");
        if (xff) {
            const first = xff.split(",")[0]?.trim();
            if (first)
                return `xff:${first}`;
        }
        const xr = headers.get("x-real-ip")?.trim();
        if (xr)
            return `xri:${xr}`;
    }
    /** 无外网代理时仅能粗粒度兜底 */
    return "direct";
};
