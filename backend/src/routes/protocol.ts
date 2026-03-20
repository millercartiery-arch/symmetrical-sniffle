import express from "express";
import {
  buildImageMessageFromPath,
  buildHttpsRequest,
  imagePathToProtocolBlock,
  inferAlignmentRulesFromSamples,
  parseFiveFieldHexStream,
  parseSessionPacket,
  sendStatelessRequest,
} from "../services/sender/stateless-sender.js";

const router = express.Router();

router.post("/protocol/parse-session", (req, res) => {
  try {
    const parsed = parseSessionPacket(req.body?.session ?? req.body);
    res.json({ code: 0, data: parsed });
  } catch (err: any) {
    res.status(400).json({ code: 400, message: err?.message || "parse session failed" });
  }
});

router.post("/protocol/parse-five-field", (req, res) => {
  try {
    const fiveFieldHex = String(req.body?.fiveFieldHex ?? "");
    const parsed = parseFiveFieldHexStream(fiveFieldHex);
    res.json({ code: 0, data: parsed });
  } catch (err: any) {
    res.status(400).json({ code: 400, message: err?.message || "parse five-field failed" });
  }
});

router.post("/protocol/build-request", (req, res) => {
  try {
    const built = buildHttpsRequest({
      endpoint: String(req.body?.endpoint ?? ""),
      method: req.body?.method,
      session: req.body?.session ?? {},
      fiveFieldHex: req.body?.fiveFieldHex,
      body: req.body?.body,
      message: req.body?.message,
      platform: req.body?.platform,
      userAgent: req.body?.userAgent,
      extraHeaders: req.body?.extraHeaders,
    });
    res.json({ code: 0, data: built });
  } catch (err: any) {
    res.status(400).json({ code: 400, message: err?.message || "build request failed" });
  }
});

router.post("/protocol/send", async (req, res) => {
  try {
    const response = await sendStatelessRequest({
      endpoint: String(req.body?.endpoint ?? ""),
      method: req.body?.method,
      session: req.body?.session ?? {},
      fiveFieldHex: req.body?.fiveFieldHex,
      body: req.body?.body,
      message: req.body?.message,
      platform: req.body?.platform,
      userAgent: req.body?.userAgent,
      extraHeaders: req.body?.extraHeaders,
    });
    res.json({ code: 0, data: response });
  } catch (err: any) {
    res.status(502).json({ code: 502, message: err?.message || "stateless send failed" });
  }
});

router.post("/protocol/infer-alignment", (req, res) => {
  try {
    const samples = Array.isArray(req.body?.samples) ? req.body.samples.map(String) : [];
    if (!samples.length) {
      return res.status(400).json({ code: 400, message: "samples is required and must be a non-empty array" });
    }
    const rules = inferAlignmentRulesFromSamples(samples);
    res.json({ code: 0, data: rules });
  } catch (err: any) {
    res.status(400).json({ code: 400, message: err?.message || "infer alignment failed" });
  }
});

router.post("/protocol/image-block", async (req, res) => {
  try {
    const absolutePath = String(req.body?.absolutePath ?? "");
    const mode = req.body?.mode === "binary" ? "binary" : "base64";
    const data = await imagePathToProtocolBlock({ absolutePath, mode });
    res.json({ code: 0, data });
  } catch (err: any) {
    res.status(400).json({ code: 400, message: err?.message || "image conversion failed" });
  }
});

router.post("/protocol/image-message-from-path", async (req, res) => {
  try {
    const data = await buildImageMessageFromPath({
      absolutePath: String(req.body?.absolutePath ?? ""),
      mode: req.body?.mode === "binary" ? "binary" : "base64",
      to: String(req.body?.to ?? ""),
      text: req.body?.text,
    });
    res.json({ code: 0, data });
  } catch (err: any) {
    res.status(400).json({ code: 400, message: err?.message || "build image message failed" });
  }
});

export default router;
