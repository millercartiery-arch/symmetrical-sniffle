import { GatewayDispatchInput, GatewaySendRequest, GatewaySendResult } from "./contracts.js";
import { buildGatewayPacket } from "./adapters.js";
import { buildDispatchRequest } from "./dispatch-manager.js";
import { GatewayErrorCode, classifyUpstreamByStatus } from "./error-codes.js";
import { GatewayError, isGatewayError } from "./errors.js";
import { normalizeGatewayRequest } from "./normalizer.js";
import { sendViaTransportDriver } from "./transport-driver.js";

const toGatewayCode = (status: number, ok: boolean): string => {
  if (ok) return "GW_200_OK";
  return classifyUpstreamByStatus(status);
};

const detectUpstreamCode = (responseBody: string): string | undefined => {
  try {
    const parsed = JSON.parse(responseBody);
    return String(parsed?.code || parsed?.errorCode || parsed?.statusCode || "").trim() || undefined;
  } catch {
    return undefined;
  }
};

export class StatelessProtocolGatewayService {
  async send(raw: GatewaySendRequest): Promise<GatewaySendResult> {
    return this.sendDispatched({
      request: raw,
      profile: {
        platform: raw.platform,
        model: String((raw.session as any)?.model || ""),
        osVersion: String((raw.session as any)?.osVersion || ""),
        userAgent: String((raw.session as any)?.userAgent || ""),
        sessionPx: String((raw.session as any)?.pxToken || ""),
      },
    });
  }

  async sendDispatched(input: GatewayDispatchInput): Promise<GatewaySendResult> {
    const raw = input.request;
    const normalized = normalizeGatewayRequest(raw);
    try {
      const dispatch = await buildDispatchRequest({
        request: raw,
        profile: input.profile,
        localAbsolutePath: input.localAbsolutePath,
      });
      const packet = dispatch.packet || buildGatewayPacket(normalized);
      const transport = await sendViaTransportDriver({
        packet,
        timeoutMs: normalized.hints.timeoutMs,
        maxRetries: normalized.hints.maxRetries,
      });

      return {
        requestId: normalized.requestId,
        idempotencyKey: normalized.idempotencyKey,
        traceId: transport.traceId,
        ok: transport.ok,
        retryable: transport.retryable,
        status: transport.status,
        gatewayCode: toGatewayCode(transport.status, transport.ok),
        upstreamCode: detectUpstreamCode(transport.responseBody),
        latencyMs: transport.latencyMs,
        responseHeaders: transport.responseHeaders,
        responseBody: transport.responseBody,
      };
    } catch (err: any) {
      if (isGatewayError(err)) {
        return {
          requestId: normalized.requestId,
          idempotencyKey: normalized.idempotencyKey,
          traceId: String((err.details as any)?.traceId || ""),
          ok: false,
          retryable: err.retryable,
          status: err.status,
          gatewayCode: err.code,
          upstreamCode: undefined,
          latencyMs: 0,
          responseHeaders: {},
          responseBody: JSON.stringify({ error: err.message }),
        };
      }
      throw new GatewayError({
        message: err?.message || "unknown gateway error",
        code: GatewayErrorCode.UNKNOWN_ERROR,
        status: 500,
        retryable: false,
      });
    }
  }
}
