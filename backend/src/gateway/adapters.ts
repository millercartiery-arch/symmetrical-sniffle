import {
  buildHeaders,
  buildMessagePayload,
  parseFiveFieldHexStream,
} from "../services/sender/stateless-sender.js";
import { GatewayPacket } from "./contracts.js";
import { NormalizedGatewayRequest } from "./normalizer.js";

interface AdapterOutput {
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const buildCommonBody = (req: NormalizedGatewayRequest) => {
  const body: Record<string, unknown> = {
    tenantId: req.tenantId,
    requestId: req.requestId,
    message: buildMessagePayload({
      platform: req.platform,
      message: req.message,
    }),
    context: {
      protocolVersion: req.hints.protocolVersion,
      adapterVersion: req.hints.adapterVersion,
      clientId: req.session.clientId,
      sessionId: req.session.sessionId,
    },
  };

  if (req.hints.fiveFieldHex) {
    body.fiveField = parseFiveFieldHexStream(req.hints.fiveFieldHex);
  }
  return body;
};

const iosAdapter = (req: NormalizedGatewayRequest): AdapterOutput => {
  const headers = buildHeaders({
    session: req.session,
    platform: "iOS",
    extraHeaders: req.extraHeaders,
  });
  headers["x-gw-platform-profile"] = "ios";
  headers["x-gw-adapter-version"] = req.hints.adapterVersion;
  headers["x-idempotency-key"] = req.idempotencyKey;
  headers["x-request-id"] = req.requestId;

  const body = buildCommonBody(req);
  return { headers, body };
};

const androidAdapter = (req: NormalizedGatewayRequest): AdapterOutput => {
  const headers = buildHeaders({
    session: req.session,
    platform: "Android",
    extraHeaders: req.extraHeaders,
  });
  headers["x-gw-platform-profile"] = "android";
  headers["x-gw-adapter-version"] = req.hints.adapterVersion;
  headers["x-idempotency-key"] = req.idempotencyKey;
  headers["x-request-id"] = req.requestId;

  const body = buildCommonBody(req);
  return { headers, body };
};

export const buildGatewayPacket = (req: NormalizedGatewayRequest): GatewayPacket => {
  const out = req.platform === "iOS" ? iosAdapter(req) : androidAdapter(req);
  return {
    url: req.hints.endpoint,
    method: req.hints.method,
    headers: out.headers,
    body: JSON.stringify(out.body),
    metadata: {
      platform: req.platform,
      messageType: req.message.type,
      protocolVersion: req.hints.protocolVersion,
      adapterVersion: req.hints.adapterVersion,
      idempotencyKey: req.idempotencyKey,
      requestId: req.requestId,
    },
  };
};
