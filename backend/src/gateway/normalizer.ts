import crypto from "crypto";
import { parseSessionPacket } from "../services/sender/stateless-sender.js";
import { GatewaySendRequest, GatewaySessionEnvelope } from "./contracts.js";
import { GatewayError } from "./errors.js";
import { GatewayErrorCode } from "./error-codes.js";

const sanitizePhone = (phone: string): string => String(phone || "").replace(/[^\d+]/g, "");

const normalizeMessage = (message: GatewaySendRequest["message"]) => {
  const to = sanitizePhone(message?.to || "");
  const type = message?.type;
  const text = String(message?.text || "").trim();
  const mediaUrl = String(message?.mediaUrl || "").trim();
  const imageBase64 = String(message?.imageBase64 || "").trim();
  const imageBinaryHex = String(message?.imageBinaryHex || "").trim();

  if (!to) {
    throw new GatewayError({
      message: "message.to is required",
      code: GatewayErrorCode.INVALID_MESSAGE,
      status: 422,
    });
  }

  if (type !== "sms" && type !== "image" && type !== "audio" && type !== "video") {
    throw new GatewayError({
      message: "message.type must be sms, image, audio or video",
      code: GatewayErrorCode.INVALID_MESSAGE,
      status: 422,
    });
  }

  if (type === "sms") {
    if (!text) {
      throw new GatewayError({
        message: "sms message requires text",
        code: GatewayErrorCode.INVALID_MESSAGE,
        status: 422,
      });
    }
  } else {
    if (!mediaUrl && !imageBase64 && !imageBinaryHex) {
      throw new GatewayError({
        message: "media message requires mediaUrl or imageBase64 or imageBinaryHex",
        code: GatewayErrorCode.INVALID_MESSAGE,
        status: 422,
      });
    }
  }

  return {
    to,
    type,
    text,
    mediaUrl: mediaUrl || undefined,
    imageBase64: imageBase64 || undefined,
    imageBinaryHex: imageBinaryHex || undefined,
  };
};

const normalizeSession = (session: unknown): GatewaySessionEnvelope => {
  const parsed = parseSessionPacket(session);
  return parsed as GatewaySessionEnvelope;
};

const computeDefaultIdempotencyKey = (req: GatewaySendRequest): string => {
  const digestRaw = [
    req.tenantId,
    req.platform,
    sanitizePhone(req.message.to),
    req.message.type,
    req.message.text || "",
    req.message.mediaUrl || "",
    req.message.imageBase64 ? "b64" : "",
    req.message.imageBinaryHex ? "bin" : "",
    req.hints.protocolVersion || "v1",
  ].join("|");
  return crypto.createHash("sha256").update(digestRaw).digest("hex");
};

export const normalizeGatewayRequest = (raw: GatewaySendRequest) => {
  if (!raw || typeof raw !== "object") {
    throw new GatewayError({
      message: "request body is required",
      code: GatewayErrorCode.INVALID_REQUEST,
      status: 400,
    });
  }

  const tenantId = String(raw.tenantId || "").trim();
  if (!tenantId) {
    throw new GatewayError({
      message: "tenantId is required",
      code: GatewayErrorCode.INVALID_REQUEST,
      status: 400,
    });
  }

  if (raw.platform !== "iOS" && raw.platform !== "Android") {
    throw new GatewayError({
      message: "platform must be iOS or Android",
      code: GatewayErrorCode.UNSUPPORTED_PLATFORM,
      status: 422,
    });
  }

  const endpoint = String(raw.hints?.endpoint || "").trim();
  if (!/^https:\/\//i.test(endpoint)) {
    throw new GatewayError({
      message: "hints.endpoint must be a valid https url",
      code: GatewayErrorCode.INVALID_PROTOCOL_HINTS,
      status: 422,
    });
  }

  const session = normalizeSession(raw.session);
  if (!session.cookie && !session.token && !session.pxToken) {
    throw new GatewayError({
      message: "session requires at least cookie or token or pxToken",
      code: GatewayErrorCode.INVALID_SESSION,
      status: 401,
    });
  }

  const method = (raw.hints?.method || "POST") as "POST" | "PUT" | "PATCH";
  if (!["POST", "PUT", "PATCH"].includes(method)) {
    throw new GatewayError({
      message: "hints.method must be POST, PUT or PATCH",
      code: GatewayErrorCode.INVALID_PROTOCOL_HINTS,
      status: 422,
    });
  }
  const protocolVersion = String(raw.hints?.protocolVersion || "v1");
  const adapterVersion = String(raw.hints?.adapterVersion || "v1");
  const timeoutMs = Math.max(1000, Math.min(60000, Number(raw.hints?.timeoutMs || 10000)));
  const maxRetries = Math.max(0, Math.min(3, Number(raw.hints?.maxRetries || 1)));

  const requestId = String(raw.requestId || crypto.randomUUID());
  const idempotencyKey = String(raw.idempotencyKey || computeDefaultIdempotencyKey(raw));

  return {
    tenantId,
    requestId,
    idempotencyKey,
    platform: raw.platform,
    session,
    message: normalizeMessage(raw.message),
    hints: {
      endpoint,
      method,
      protocolVersion,
      adapterVersion,
      fiveFieldHex: raw.hints?.fiveFieldHex,
      timeoutMs,
      maxRetries,
    },
    extraHeaders: raw.extraHeaders || {},
  };
};

export type NormalizedGatewayRequest = ReturnType<typeof normalizeGatewayRequest>;
