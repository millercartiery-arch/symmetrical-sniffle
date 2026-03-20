import { URL } from "url";
import { buildGatewayPacket } from "./adapters.js";
import { DeviceProfile, GatewayPacket, GatewaySendRequest } from "./contracts.js";
import { GatewayError } from "./errors.js";
import { GatewayErrorCode } from "./error-codes.js";
import { buildMultipartMediaPayload } from "./media-payload-builder.js";
import { normalizeGatewayRequest } from "./normalizer.js";
import { resolveFingerprintPolicy } from "./fingerprint-library.js";

interface DispatchBuildInput {
  request: GatewaySendRequest;
  profile: DeviceProfile;
  localAbsolutePath?: string;
}

interface DispatchOutput {
  packet: GatewayPacket;
  http2Headers?: Record<string, string>;
  notes: string[];
}

const buildHttp2PseudoHeaders = (packet: GatewayPacket): Record<string, string> => {
  const url = new URL(packet.url);
  return {
    ":method": packet.method,
    ":scheme": url.protocol.replace(":", ""),
    ":authority": url.host,
    ":path": `${url.pathname}${url.search}`,
  };
};

export const buildDispatchRequest = async (input: DispatchBuildInput): Promise<DispatchOutput> => {
  const normalized = normalizeGatewayRequest(input.request);
  if (normalized.platform !== input.profile.platform) {
    throw new GatewayError({
      message: `platform mismatch: request=${normalized.platform} profile=${input.profile.platform}`,
      code: GatewayErrorCode.INVALID_REQUEST,
      status: 400,
    });
  }
  const notes: string[] = [];
  let packet = buildGatewayPacket(normalized);
  const fingerprintPolicy = resolveFingerprintPolicy({
    platform: input.profile.platform,
    profile: input.profile,
  });
  packet.headers["x-device-fingerprint-policy"] = fingerprintPolicy.policyId;
  packet.headers["x-tls-client-profile"] = fingerprintPolicy.tlsClientProfile;
  packet.headers["x-ja3-policy-id"] = fingerprintPolicy.ja3PolicyId;
  packet.headers["x-ja4-policy-id"] = fingerprintPolicy.ja4PolicyId;
  packet.headers["x-h2-weight-min"] = String(fingerprintPolicy.h2WeightRange[0]);
  packet.headers["x-h2-weight-max"] = String(fingerprintPolicy.h2WeightRange[1]);
  packet.headers["x-h2-window-min"] = String(fingerprintPolicy.h2WindowRange[0]);
  packet.headers["x-h2-window-max"] = String(fingerprintPolicy.h2WindowRange[1]);
  notes.push(`fingerprint policy mapped: ${fingerprintPolicy.policyId}`);

  if (normalized.message.type !== "sms" && input.localAbsolutePath) {
    const media = await buildMultipartMediaPayload({
      localAbsolutePath: input.localAbsolutePath,
      profile: input.profile,
      fieldName: "file",
      extraFields: {
        to: normalized.message.to,
        text: normalized.message.text || "",
      },
      includeHexPreview: false,
    });
    packet = {
      ...packet,
      headers: {
        ...packet.headers,
        ...media.headers,
      },
      body: media.bodyStream,
    };
    notes.push(`multipart built from local media (${media.fileName}, ${media.mime}, ${media.size} bytes)`);
    notes.push(`binary-to-hex preview ready (stream mode, bodyLength=${media.bodyLength} bytes)`);
  }

  if (input.profile.platform === "iOS") {
    // Compliance-safe: only inject already issued Session-PX value, never synthesize device fingerprint.
    const sessionPx = String(input.profile.sessionPx || normalized.session.pxToken || "").trim();
    if (!sessionPx) {
      throw new GatewayError({
        message: "iOS dispatch requires provided Session-PX token from upstream",
        code: GatewayErrorCode.INVALID_SESSION,
        status: 401,
      });
    }
    packet.headers["x-session-px"] = sessionPx;
    packet.headers["x-hardware-fingerprint"] = String(input.profile.hardwareFingerprint || "").trim();

    const h2 = buildHttp2PseudoHeaders(packet);
    h2["x-session-px"] = sessionPx;
    if (packet.headers["x-hardware-fingerprint"]) {
      h2["x-hardware-fingerprint"] = packet.headers["x-hardware-fingerprint"];
    }
    packet.headers["x-h2-pseudo-method"] = h2[":method"];
    packet.headers["x-h2-pseudo-scheme"] = h2[":scheme"];
    packet.headers["x-h2-pseudo-authority"] = h2[":authority"];
    packet.headers["x-h2-pseudo-path"] = h2[":path"];
    notes.push("iOS HTTP/2 headers populated with upstream-provided Session-PX");
    return { packet, http2Headers: h2, notes };
  }

  if (input.profile.platform === "Android") {
    notes.push(`${fingerprintPolicy.notes}; JA signatures are mapped as policy tags for egress`);
  }

  return { packet, notes };
};
