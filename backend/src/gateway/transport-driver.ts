import crypto from "crypto";
import { GatewayPacket } from "./contracts.js";
import { GatewayErrorCode, isRetryableStatus } from "./error-codes.js";
import { GatewayError } from "./errors.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GATEWAY_RETRY_BASE_MS = Math.max(50, Number(process.env.GATEWAY_RETRY_BASE_MS || 200));
const GATEWAY_RETRY_MAX_MS = Math.max(GATEWAY_RETRY_BASE_MS, Number(process.env.GATEWAY_RETRY_MAX_MS || 3000));
const GATEWAY_TIMEOUT_JITTER_RATIO = Math.min(0.35, Math.max(0, Number(process.env.GATEWAY_TIMEOUT_JITTER_RATIO || 0.12)));

const buildTraceId = () => `gw-${crypto.randomUUID()}`;

const toHeadersObject = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
};

const withJitter = (value: number, ratio: number): number => {
  if (value <= 0 || ratio <= 0) return Math.max(0, Math.round(value));
  const factor = 1 - ratio + Math.random() * ratio * 2;
  return Math.max(0, Math.round(value * factor));
};

const computeAttemptTimeoutMs = (baseTimeoutMs: number, attempt: number): number => {
  const scaled = baseTimeoutMs + attempt * 1500;
  return withJitter(Math.min(90000, Math.max(1000, scaled)), GATEWAY_TIMEOUT_JITTER_RATIO);
};

const computeRetryDelayMs = (attempt: number): number => {
  const exponential = GATEWAY_RETRY_BASE_MS * Math.pow(2, attempt);
  const bounded = Math.min(GATEWAY_RETRY_MAX_MS, exponential);
  return withJitter(bounded, 0.2);
};

const pickInRange = (minValue: unknown, maxValue: unknown, fallbackMin: number, fallbackMax: number): number => {
  const min = Math.max(1, Number(minValue || fallbackMin));
  const max = Math.max(min, Number(maxValue || fallbackMax));
  return min + Math.floor(Math.random() * (max - min + 1));
};

const buildShapedHeaders = (baseHeaders: Record<string, string>, attempt: number): Record<string, string> => {
  const headers = { ...baseHeaders };
  const weight = pickInRange(headers["x-h2-weight-min"], headers["x-h2-weight-max"], 32, 223);
  const window = pickInRange(headers["x-h2-window-min"], headers["x-h2-window-max"], 65535, 131070);
  const interleaveDepth = pickInRange(headers["x-h2-interleave-min"], headers["x-h2-interleave-max"], 2, 8);
  // Stream-shaping metadata for upstream egress layer/proxy; harmless if upstream ignores it.
  if (!headers["x-h2-priority-weight"]) {
    headers["x-h2-priority-weight"] = String(weight);
  }
  if (!headers["x-h2-window-size"]) {
    headers["x-h2-window-size"] = String(window);
  }
  headers["x-h2-interleave-depth"] = String(interleaveDepth);
  headers["x-stream-attempt"] = String(attempt + 1);
  return headers;
};

type EgressProfileApplier = (args: { profile: string; url: string; headers: Record<string, string> }) => Promise<void> | void;
let egressProfileApplier: EgressProfileApplier | null = null;
export const setEgressProfileApplier = (fn: EgressProfileApplier | null) => {
  egressProfileApplier = fn;
};

export const sendViaTransportDriver = async (input: {
  packet: GatewayPacket;
  timeoutMs: number;
  maxRetries: number;
}) => {
  const traceId = buildTraceId();
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= input.maxRetries) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const attemptTimeoutMs = computeAttemptTimeoutMs(input.timeoutMs, attempt);
    const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      const shapedHeaders = buildShapedHeaders(input.packet.headers, attempt);
      const tlsProfile = shapedHeaders["x-tls-client-profile"];
      if (tlsProfile && !egressProfileApplier) {
        shapedHeaders["x-egress-profile-applied"] = "pass-through";
      }
      if (tlsProfile && egressProfileApplier) {
        await egressProfileApplier({ profile: tlsProfile, url: input.packet.url, headers: shapedHeaders });
        shapedHeaders["x-egress-profile-applied"] = "custom";
      }
      const res = await fetch(
        input.packet.url,
        {
          method: input.packet.method,
          headers: {
            ...shapedHeaders,
            "x-trace-id": traceId,
            "x-dispatch-attempt": String(attempt + 1),
          },
          body: input.packet.body as any,
          signal: controller.signal,
        } as any // cast to avoid TS complaining about non‑standard fields
      );
      clearTimeout(timer);
      const responseBody = await res.text();
      const latencyMs = Date.now() - startedAt;
      return {
        traceId,
        status: res.status,
        ok: res.ok,
        retryable: isRetryableStatus(res.status),
        responseHeaders: toHeadersObject(res.headers),
        responseBody,
        latencyMs,
      };
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;
      const isTimeout = String(err?.name || "").includes("Abort");
      const canRetry = attempt < input.maxRetries;

      if (!canRetry) {
        throw new GatewayError({
          message: isTimeout ? "transport timeout" : `transport network error: ${err?.message || err}`,
          code: isTimeout ? GatewayErrorCode.TRANSPORT_TIMEOUT : GatewayErrorCode.TRANSPORT_NETWORK_ERROR,
          status: isTimeout ? 504 : 503,
          retryable: true,
          details: { traceId, attempt },
        });
      }

      await sleep(computeRetryDelayMs(attempt));
      attempt += 1;
    }
  }

  throw new GatewayError({
    message: `transport failed: ${String((lastError as any)?.message || lastError || "unknown")}`,
    code: GatewayErrorCode.TRANSPORT_NETWORK_ERROR,
    status: 503,
    retryable: true,
  });
};
