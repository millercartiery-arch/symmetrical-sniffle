import fs from "fs/promises";
import path from "path";

export type Platform = "iOS" | "Android";

export interface FiveFieldPacket {
  raw: string;
  fields: string[];
  fieldBytesHex: string[];
  fieldBytesLength: number[];
  totalBytes: number;
}

export interface SessionEnvelope {
  token?: string;
  cookie?: string;
  sessionId?: string;
  clientId?: string;
  signature?: string;
  uuid?: string;
  vid?: string;
  fp?: string;
  idfa?: string;
  gaid?: string;
  appVersion?: string;
  brand?: string;
  language?: string;
  model?: string;
  osVersion?: string;
  os?: Platform;
  userAgent?: string;
  pxToken?: string;
  [key: string]: unknown;
}

export interface RequestBuildInput {
  endpoint: string;
  method?: string;
  session: SessionEnvelope;
  fiveFieldHex?: string;
  body?: unknown;
  message?: MessageBuildInput;
  platform?: Platform;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
}

export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

const IOS_UA =
  "TextNow/26.8.0 (iPhone14,8; iOS 18.4.1; Scale/3.00)";
const ANDROID_UA =
  "TextNow/26.8.0 (Pixel 8 Pro; Android 14; Scale/3.00)";

const normalizeKey = (key: string): string => key.trim().toLowerCase().replace(/[_\-\s]/g, "");

const toStr = (v: unknown): string => String(v ?? "").trim();

const parsePairs = (input: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const segment of input.split(/[;\n&]/).map((s) => s.trim()).filter(Boolean)) {
    const [left, ...rest] = segment.split("=");
    if (!left || rest.length === 0) continue;
    result[left.trim()] = rest.join("=").trim();
  }
  return result;
};

export function parseSessionPacket(input: unknown): SessionEnvelope {
  if (typeof input === "object" && input !== null) {
    return normalizeSession(input as Record<string, unknown>);
  }

  const raw = toStr(input);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return normalizeSession(parsed as Record<string, unknown>);
    }
  } catch {
    // fallthrough to pair parser
  }

  return normalizeSession(parsePairs(raw));
}

function normalizeSession(raw: Record<string, unknown>): SessionEnvelope {
  const index = new Map<string, unknown>();
  for (const [k, v] of Object.entries(raw)) {
    index.set(normalizeKey(k), v);
  }
  const get = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const value = toStr(index.get(normalizeKey(k)));
      if (value) return value;
    }
    return undefined;
  };

  const osRaw = (get("os", "platform", "x-px-os") || "").toLowerCase();
  const os: Platform | undefined =
    osRaw === "ios" || osRaw === "iphone" ? "iOS" : osRaw === "android" ? "Android" : undefined;

  return {
    token: get("token", "authorization"),
    cookie: get("cookie"),
    pxToken: get("pxtoken", "x-px-authorization", "xpxauthorization"),
    sessionId: get("sessionid", "tnsessionid", "x-tn-session-id"),
    clientId: get("clientid", "tnclientid"),
    signature: get("signature", "x-tn-integrity-session"),
    uuid: get("uuid", "x-px-uuid"),
    vid: get("vid", "x-px-vid"),
    fp: get("fp", "x-px-device-fp", "idfv"),
    idfa: get("idfa"),
    gaid: get("gaid", "gpsadid"),
    appVersion: get("appversion", "x-px-mobile-sdk-version"),
    brand: get("brand"),
    language: get("language", "acceptlanguage"),
    model: get("model", "x-px-device-model"),
    osVersion: get("osversion", "x-px-os-version"),
    os,
    userAgent: get("useragent", "user-agent"),
    ...raw,
  };
}

export function parseFiveFieldHexStream(hexStream: string): FiveFieldPacket {
  const normalized = toStr(hexStream).replace(/^0x/i, "");
  if (!normalized) throw new Error("fiveFieldHex is empty");

  const segments = normalized.includes("|")
    ? normalized.split("|")
    : normalized.includes(",")
      ? normalized.split(",")
      : normalized.split(/\s+/);

  const fields = segments.map((s) => s.trim()).filter(Boolean);
  if (fields.length !== 5) {
    throw new Error(`five-field protocol requires exactly 5 fields, received ${fields.length}`);
  }

  const fieldBytesHex = fields.map((field) => {
    const clean = field.replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
      throw new Error(`invalid hex field: ${field}`);
    }
    return clean.toLowerCase();
  });
  const fieldBytesLength = fieldBytesHex.map((hex) => hex.length / 2);
  const totalBytes = fieldBytesLength.reduce((acc, v) => acc + v, 0);

  return {
    raw: hexStream,
    fields,
    fieldBytesHex,
    fieldBytesLength,
    totalBytes,
  };
}

export function buildHeaders(input: {
  session: SessionEnvelope;
  platform?: Platform;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
}): Record<string, string> {
  const { session, extraHeaders } = input;
  const platform = input.platform || session.os || "Android";
  const userAgent = input.userAgent || session.userAgent || (platform === "iOS" ? IOS_UA : ANDROID_UA);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept:
      platform === "iOS"
        ? "application/json"
        : "application/json, text/plain, */*",
    "accept-language": session.language || "en-US,en;q=0.9",
    "user-agent": userAgent,
    "x-client-platform": platform,
    "x-px-os": platform,
    connection: platform === "iOS" ? "keep-alive" : "Keep-Alive",
  };

  if (session.token) {
    headers.authorization = /^bearer\s+/i.test(session.token) ? session.token : `Bearer ${session.token}`;
  }
  if (session.cookie) headers.cookie = session.cookie;
  if (session.pxToken) headers["x-px-authorization"] = session.pxToken;
  if (session.signature) headers["x-tn-integrity-session"] = session.signature;
  if (session.sessionId) headers["x-tn-session-id"] = session.sessionId;
  if (session.clientId) headers["x-client-id"] = session.clientId;
  if (session.uuid) headers["x-px-uuid"] = session.uuid;
  if (session.vid) headers["x-px-vid"] = session.vid;
  if (session.fp) headers["x-px-device-fp"] = session.fp;
  if (session.appVersion) headers["x-px-mobile-sdk-version"] = session.appVersion;
  headers["x-px-device-model"] = session.model || (platform === "iOS" ? "iPhone14,8" : "Pixel 8 Pro");
  headers["x-px-os-version"] = session.osVersion || (platform === "iOS" ? "18.4.1" : "14");
  if (session.idfa) headers["x-idfa"] = session.idfa;
  if (session.gaid) headers["x-gaid"] = session.gaid;

  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      const value = toStr(v);
      if (value) headers[k.toLowerCase()] = value;
    }
  }

  return headers;
}

export type MessageType = "sms" | "image" | "audio" | "video";
export interface MessageBuildInput {
  to: string;
  text?: string;
  type?: MessageType;
  mediaUrl?: string;
  imageBase64?: string;
  imageBinaryHex?: string;
  localImagePath?: string;
}

const sanitizePhone = (phone: string): string => phone.replace(/[^\d+]/g, "");

export function buildMessagePayload(input: { message: MessageBuildInput; platform: Platform }) {
  const type: MessageType = input.message.type || (input.message.mediaUrl || input.message.imageBase64 || input.message.imageBinaryHex ? "image" : "sms");
  const to = sanitizePhone(toStr(input.message.to));
  if (!to) throw new Error("message.to is required");

  if (type === "sms") {
    const text = toStr(input.message.text);
    if (!text) throw new Error("sms text is required");
    return {
      channel: "sms",
      platform: input.platform,
      to,
      text,
    };
  }

  const text = toStr(input.message.text);
  const attachments: Array<Record<string, string>> = [];
  if (toStr(input.message.mediaUrl)) {
    attachments.push({ kind: "url", value: toStr(input.message.mediaUrl) });
  }
  if (toStr(input.message.imageBase64)) {
    attachments.push({ kind: "base64", value: toStr(input.message.imageBase64) });
  }
  if (toStr(input.message.imageBinaryHex)) {
    attachments.push({ kind: "binary", value: toStr(input.message.imageBinaryHex) });
  }
  if (!attachments.length) {
    throw new Error("media message requires mediaUrl or imageBase64 or imageBinaryHex");
  }
  return {
    channel: "mms",
    platform: input.platform,
    to,
    text,
    mediaType: type,
    attachments,
  };
}

export function buildHttpsRequest(input: RequestBuildInput): BuiltRequest {
  const method = (input.method || "POST").toUpperCase();
  const parsedSession = parseSessionPacket(input.session);
  const platform = input.platform || parsedSession.os || "Android";
  const headers = buildHeaders({
    session: parsedSession,
    platform,
    userAgent: input.userAgent,
    extraHeaders: input.extraHeaders,
  });

  let bodyPayload: Record<string, unknown> = {};
  if (input.body && typeof input.body === "object") bodyPayload = { ...(input.body as Record<string, unknown>) };
  if (input.fiveFieldHex) bodyPayload.fiveField = parseFiveFieldHexStream(input.fiveFieldHex);
  if (input.message) bodyPayload.message = buildMessagePayload({ message: input.message, platform });

  const body = method === "GET" ? null : JSON.stringify(bodyPayload);

  return {
    url: input.endpoint,
    method,
    headers,
    body,
  };
}

export async function sendStatelessRequest(input: RequestBuildInput): Promise<{
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}> {
  const req = buildHttpsRequest(input);
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });

  const responseText = await res.text();
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: res.status,
    ok: res.ok,
    headers: responseHeaders,
    body: responseText,
  };
}

export function inferAlignmentRulesFromSamples(samples: string[]) {
  const parsed = samples.map((s) => parseFiveFieldHexStream(s));
  const fieldLengthsByIndex = [0, 1, 2, 3, 4].map((i) => parsed.map((p) => p.fieldBytesLength[i]));

  const alignment = fieldLengthsByIndex.map((lengths, index) => {
    const min = Math.min(...lengths);
    const max = Math.max(...lengths);
    const avg = Number((lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(2));
    const allEven = lengths.every((n) => n % 2 === 0);
    const allAligned4 = lengths.every((n) => n % 4 === 0);
    return {
      field: index + 1,
      minBytes: min,
      maxBytes: max,
      avgBytes: avg,
      evenByteAligned: allEven,
      fourByteAligned: allAligned4,
      stableLength: min === max,
    };
  });

  return {
    sampleCount: parsed.length,
    totalBytesRange: {
      min: Math.min(...parsed.map((p) => p.totalBytes)),
      max: Math.max(...parsed.map((p) => p.totalBytes)),
    },
    fields: alignment,
    assumption: "Alignment derived from black-box samples; validate against live captures before production enforcement.",
  };
}

export async function imagePathToProtocolBlock(input: {
  absolutePath: string;
  mode: "base64" | "binary";
}) {
  const absolutePath = toStr(input.absolutePath);
  if (!absolutePath) throw new Error("absolutePath is required");
  if (!path.isAbsolute(absolutePath)) throw new Error("absolutePath must be an absolute filesystem path");

  const buffer = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase().replace(".", "");
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "application/octet-stream";

  if (input.mode === "base64") {
    const value = buffer.toString("base64");
    return {
      mode: "base64" as const,
      mime,
      size: buffer.byteLength,
      value,
      dataUri: `data:${mime};base64,${value}`,
    };
  }

  return {
    mode: "binary" as const,
    mime,
    size: buffer.byteLength,
    value: buffer.toString("hex"),
  };
}

export async function buildImageMessageFromPath(input: {
  absolutePath: string;
  mode: "base64" | "binary";
  to: string;
  text?: string;
}): Promise<MessageBuildInput> {
  const block = await imagePathToProtocolBlock({ absolutePath: input.absolutePath, mode: input.mode });
  return {
    to: input.to,
    text: input.text,
    type: "image",
    imageBase64: block.mode === "base64" ? block.value : undefined,
    imageBinaryHex: block.mode === "binary" ? block.value : undefined,
  };
}
