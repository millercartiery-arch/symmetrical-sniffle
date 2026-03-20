import express from "express";
import { buildGatewayPacket } from "../gateway/adapters.js";
import { buildDispatchRequest } from "../gateway/dispatch-manager.js";
import { buildMultipartMediaPayload } from "../gateway/media-payload-builder.js";
import { GatewayJob, GatewaySendRequest } from "../gateway/contracts.js";
import { isGatewayError } from "../gateway/errors.js";
import { normalizeGatewayRequest } from "../gateway/normalizer.js";
import { GatewayOrchestrator } from "../gateway/orchestrator.js";
import { StatelessProtocolGatewayService } from "../gateway/service.js";

const router = express.Router();
const gatewayService = new StatelessProtocolGatewayService();
const gatewayOrchestrator = new GatewayOrchestrator();

router.post("/gateway/validate", (req, res) => {
  try {
    const normalized = normalizeGatewayRequest(req.body as GatewaySendRequest);
    res.json({
      code: 0,
      data: {
        requestId: normalized.requestId,
        idempotencyKey: normalized.idempotencyKey,
        platform: normalized.platform,
        endpoint: normalized.hints.endpoint,
        protocolVersion: normalized.hints.protocolVersion,
        adapterVersion: normalized.hints.adapterVersion,
      },
    });
  } catch (err: any) {
    if (isGatewayError(err)) {
      return res.status(err.status).json({ code: err.code, message: err.message, retryable: err.retryable });
    }
    res.status(500).json({ code: "GW_500_UNKNOWN_ERROR", message: err?.message || "unknown error" });
  }
});

router.post("/gateway/build-packet", (req, res) => {
  try {
    const normalized = normalizeGatewayRequest(req.body as GatewaySendRequest);
    const packet = buildGatewayPacket(normalized);
    res.json({ code: 0, data: packet });
  } catch (err: any) {
    if (isGatewayError(err)) {
      return res.status(err.status).json({ code: err.code, message: err.message, retryable: err.retryable });
    }
    res.status(500).json({ code: "GW_500_UNKNOWN_ERROR", message: err?.message || "unknown error" });
  }
});

router.post("/gateway/send", async (req, res) => {
  try {
    const p = String(req.body?.profile?.platform || req.body?.platform || req.body?.request?.platform || "Android");
    const platform = p === "iOS" ? "iOS" : "Android";
    const reqPlatform = String(req.body?.request?.platform || req.body?.platform || platform);
    if (reqPlatform !== platform) {
      return res.status(400).json({
        code: "GW_400_INVALID_REQUEST",
        message: `platform mismatch: request=${reqPlatform}, profile=${platform}`,
      });
    }
    const result = await gatewayService.sendDispatched({
      request: req.body?.request || (req.body as GatewaySendRequest),
      profile: req.body?.profile || {
        platform,
      },
      localAbsolutePath: req.body?.localAbsolutePath,
    });
    const status = result.ok ? 200 : result.status >= 400 && result.status < 600 ? result.status : 502;
    res.status(status).json({ code: result.gatewayCode, data: result });
  } catch (err: any) {
    if (isGatewayError(err)) {
      return res.status(err.status).json({ code: err.code, message: err.message, retryable: err.retryable });
    }
    res.status(500).json({ code: "GW_500_UNKNOWN_ERROR", message: err?.message || "unknown error" });
  }
});

router.post("/gateway/send-batch", async (req, res) => {
  try {
    const jobs = (Array.isArray(req.body?.jobs) ? req.body.jobs : []) as GatewayJob[];
    if (!jobs.length) {
      return res.status(400).json({ code: "GW_400_INVALID_REQUEST", message: "jobs must be a non-empty array" });
    }
    const results = await gatewayOrchestrator.dispatchBatch(jobs, req.body?.options);
    const summary = {
      total: results.length,
      success: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
    res.json({ code: 0, data: { summary, results } });
  } catch (err: any) {
    if (isGatewayError(err)) {
      return res.status(err.status).json({ code: err.code, message: err.message, retryable: err.retryable });
    }
    res.status(500).json({ code: "GW_500_UNKNOWN_ERROR", message: err?.message || "unknown error" });
  }
});

router.post("/gateway/media/build-multipart", async (req, res) => {
  try {
    const data = await buildMultipartMediaPayload({
      localAbsolutePath: String(req.body?.localAbsolutePath || ""),
      profile: {
        platform: req.body?.profile?.platform,
        model: req.body?.profile?.model,
        osVersion: req.body?.profile?.osVersion,
        appVersion: req.body?.profile?.appVersion,
        userAgent: req.body?.profile?.userAgent,
        sessionPx: req.body?.profile?.sessionPx,
        hardwareFingerprint: req.body?.profile?.hardwareFingerprint,
      },
      fieldName: req.body?.fieldName,
      fileName: req.body?.fileName,
      extraFields: req.body?.extraFields,
      includeHexPreview: !!req.body?.includeHexPreview,
      hexPreviewLimitBytes: req.body?.hexPreviewLimitBytes,
    } as any);
    res.json({
      code: 0,
      data: {
        contentType: data.contentType,
        boundary: data.boundary,
        headers: data.headers,
        mime: data.mime,
        fileName: data.fileName,
        size: data.size,
        bodyLength: data.bodyLength,
        bodyHexPreview: data.bodyHexPreview,
        fileHexPreview: data.fileHexPreview,
      },
    });
  } catch (err: any) {
    if (isGatewayError(err)) {
      return res.status(err.status).json({ code: err.code, message: err.message, retryable: err.retryable });
    }
    res.status(500).json({ code: "GW_500_UNKNOWN_ERROR", message: err?.message || "unknown error" });
  }
});

router.post("/gateway/dispatch/build", async (req, res) => {
  try {
    const data = await buildDispatchRequest({
      request: req.body?.request as GatewaySendRequest,
      profile: req.body?.profile,
      localAbsolutePath: req.body?.localAbsolutePath,
    });
    res.json({
      code: 0,
      data: {
        packet: {
          ...data.packet,
          body:
            typeof data.packet.body === "string"
              ? data.packet.body
              : Buffer.isBuffer(data.packet.body)
                ? (data.packet.body as Buffer).toString("hex")
                : "[stream]",
        },
        http2Headers: data.http2Headers,
        notes: data.notes,
      },
    });
  } catch (err: any) {
    if (isGatewayError(err)) {
      return res.status(err.status).json({ code: err.code, message: err.message, retryable: err.retryable });
    }
    res.status(500).json({ code: "GW_500_UNKNOWN_ERROR", message: err?.message || "unknown error" });
  }
});

export default router;
