const toTrimmed = (v: any) => String(v !== null && v !== void 0 ? v : "").trim();

const getCaseInsensitive = (obj: any, key: string) => {
    if (Object.prototype.hasOwnProperty.call(obj, key))
        return obj[key];
    const lower = key.toLowerCase();
    for (const k of Object.keys(obj)) {
        if (k.toLowerCase() === lower)
            return obj[k];
    }
    return undefined;
};

const pick = (obj: any, keys: string[]) => {
    for (const key of keys) {
        const value = getCaseInsensitive(obj, key);
        const s = toTrimmed(value);
        if (s)
            return s;
    }
    return "";
};

export const normalizeSystemType = (platform: any) => {
    const p = toTrimmed(platform).toLowerCase();
    if (p === "ios" || p === "iphone")
        return "iOS";
    if (p === "android")
        return "Android";
    if (p === "web")
        return "Web";
    return "Android";
};

export const normalizeStatus = (status: any) => {
    const s = toTrimmed(status).toLowerCase();
    if (s === "ready" || s === "valid" || s === "active")
        return "Ready";
    if (s === "cooldown" || s === "cooling")
        return "Cooldown";
    if (s === "dead" || s === "invalid")
        return "Dead";
    if (s === "busy")
        return "Busy";
    return "Ready";
};

export const normalizeImportAccount = (raw: any) => {
    const obj = (raw && typeof raw === "object" ? raw : {});
    const inferredPlatform = pick(obj, ["platform"]) ||
        (pick(obj, ["X-PX-OS", "x-px-os"]).toLowerCase() === "ios" ? "ios" : "android");
    
    const signatureFromHeader = pick(obj, ["X-TN-Integrity-Session", "x-tn-integrity-session", "X-PX-AUTHORIZATION", "x-px-authorization"]);

    return {
        phone: pick(obj, ["phone"]),
        email: pick(obj, ["email"]),
        username: pick(obj, ["username"]),
        password: pick(obj, ["password"]) || "123456",
        token: pick(obj, ["token", "cookie", "Cookie"]),
        proxyUrl: pick(obj, ["proxy_url", "proxyUrl"]),
        platform: normalizeSystemType(inferredPlatform),
        status: normalizeStatus(pick(obj, ["status"])),
        clientId: pick(obj, ["clientId"]),
        model: pick(obj, ["model", "X-PX-DEVICE-MODEL", "x-px-device-model"]),
        osVersion: pick(obj, ["osVersion", "X-PX-OS-VERSION", "x-px-os-version"]),
        userAgent: pick(obj, ["userAgent", "User-Agent", "user-agent"]),
        uuid: pick(obj, ["uuid", "X-PX-UUID", "x-px-uuid"]),
        vid: pick(obj, ["vid", "X-PX-VID", "x-px-vid"]),
        signature: pick(obj, ["signature"]) || signatureFromHeader,
        appVersion: pick(obj, ["appVersion", "X-PX-MOBILE-SDK-VERSION", "x-px-mobile-sdk-version"]),
        brand: pick(obj, ["brand"]),
        language: pick(obj, ["language"]),
        fp: pick(obj, ["fp", "X-PX-DEVICE-FP", "x-px-device-fp", "IDFV", "idfv"]),
        sessionId: pick(obj, ["sessionId"]),
    };
};

export const getMissingRequiredFields = (acc: any) => {
    const missing: string[] = [];
    if (!acc.phone) missing.push("phone");
    if (!acc.username) missing.push("username");
    if (!acc.token) missing.push("token");
    if (!acc.clientId) missing.push("clientId");
    if (!acc.signature) missing.push("signature");
    return missing;
};
