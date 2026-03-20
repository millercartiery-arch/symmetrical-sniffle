import express from "express";
import multer from "multer";
import path from "path";
import { dispatchEngine, ensureDispatchEngineStarted } from "../gateway/runtime.js";
import { QueuedDispatchTask } from "../gateway/dispatch-engine.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/sessions/import", upload.single("file"), async (req, res) => {
  await ensureDispatchEngineStarted();
  try {
    const rawTextBody = String(req.body?.rawText || req.body?.text || "").trim();
    const rawTextFile = req.file ? req.file.buffer.toString("utf8") : "";
    const rawText = rawTextBody || rawTextFile;
    if (!rawText) {
      return res.status(400).json({ code: "GW_400_INVALID_REQUEST", message: "rawText or file is required" });
    }
    const cooldownMs = Math.max(0, Number(req.body?.cooldownMs || 30000));
    const maxLines = Math.max(1, Math.min(20000, Number(req.body?.maxLines || 10000)));
    const result = dispatchEngine.importSessionsFromRaw(rawText, cooldownMs, maxLines);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: "GW_500_UNKNOWN_ERROR", message: err?.message || "import failed" });
  }
});

router.get("/system/stats", async (_req, res) => {
  await ensureDispatchEngineStarted();
  res.json({
    code: 0,
    data: {
      ...dispatchEngine.getSystemStats(),
      sessions: dispatchEngine.getSessionStates(),
      subAccounts: dispatchEngine.getSubAccountMonitor(),
    },
  });
});

router.post("/system/dispatch/submit-batch", async (req, res) => {
  await ensureDispatchEngineStarted();
  const tasks = (Array.isArray(req.body?.tasks) ? req.body.tasks : []) as QueuedDispatchTask[];
  if (!tasks.length) {
    return res.status(400).json({ code: "GW_400_INVALID_REQUEST", message: "tasks must be a non-empty array" });
  }
  const ids = dispatchEngine.submitBatch(tasks);
  res.json({ code: 0, data: { accepted: ids.length, taskIds: ids } });
});

router.get("/system/logs", async (req, res) => {
  await ensureDispatchEngineStarted();
  const subAccountId = String(req.query.subAccountId || "").trim() || undefined;
  const limit = Number(req.query.limit || 100);
  const logs = dispatchEngine.getDispatchLogs({ subAccountId, limit });
  res.json({ code: 0, data: logs });
});

router.get("/system/shadow-events", async (req, res) => {
  await ensureDispatchEngineStarted();
  const limit = Number(req.query.limit || 100);
  const events = dispatchEngine.getShadowFailoverEvents(limit);
  res.json({ code: 0, data: events });
});

router.get("/proxy/center", async (_req, res) => {
  await ensureDispatchEngineStarted();
  res.json({ code: 0, data: dispatchEngine.getProxyCenter() });
});

router.get("/proxy/fetcher/config", async (_req, res) => {
  await ensureDispatchEngineStarted();
  const config = dispatchEngine.getProxyFetcherConfig();
  res.json({ code: 0, data: config });
});

router.get("/proxy/whitelist/config", async (_req, res) => {
  await ensureDispatchEngineStarted();
  const config = dispatchEngine.getProxyWhitelistConfig();
  res.json({ code: 0, data: config });
});

router.post("/proxy/refresh", async (_req, res) => {
  await ensureDispatchEngineStarted();
  const count = await dispatchEngine.refreshProxyFetcherNow().catch(() => 0);
  res.json({ code: 0, data: { refreshed: count } });
});

router.post("/proxy/fetcher/config", async (req, res) => {
  await ensureDispatchEngineStarted();
  const apiUrl = String(req.body?.apiUrl || "").trim();
  const intervalMinutes = Math.max(1, Number(req.body?.intervalMinutes || 5));
  if (!apiUrl) {
    return res.status(400).json({ code: "GW_400_INVALID_REQUEST", message: "apiUrl is required" });
  }
  dispatchEngine.configureProxyFetcher({
    apiUrl,
    intervalMinutes,
    authHeader: req.body?.authHeader,
  });
  res.json({ code: 0, data: { configured: true } });
});

router.post("/proxy/whitelist/config", async (req, res) => {
  await ensureDispatchEngineStarted();
  const apiUrl = String(req.body?.apiUrl || "").trim();
  if (!apiUrl) return res.status(400).json({ code: "GW_400_INVALID_REQUEST", message: "apiUrl is required" });
  dispatchEngine.configureProxyWhitelist({ apiUrl, authHeader: req.body?.authHeader });
  res.json({ code: 0, data: { configured: true } });
});

router.post("/proxy/whitelist/update", async (req, res) => {
  await ensureDispatchEngineStarted();
  const serverIp = String(req.body?.serverIp || "").trim();
  if (!serverIp) return res.status(400).json({ code: "GW_400_INVALID_REQUEST", message: "serverIp is required" });
  await dispatchEngine.updateProxyWhitelist(serverIp).catch(() => undefined);
  res.json({ code: 0, data: { updated: true, serverIp } });
});

router.get("/proxy/bad-debt/export", async (_req, res) => {
  await ensureDispatchEngineStarted();
  res.json({ code: 0, data: dispatchEngine.exportBadDebtIps() });
});

router.post("/subaccounts/create", async (req, res) => {
  await ensureDispatchEngineStarted();
  const count = Math.max(1, Number(req.body?.count || 1));
  const perAccount = Math.max(0, Number(req.body?.perAccount || 0));
  const created = dispatchEngine.createSubAccounts(count, perAccount);
  res.json({ code: 0, data: { createdCount: created.length, items: created } });
});

router.get("/subaccounts", async (_req, res) => {
  await ensureDispatchEngineStarted();
  res.json({ code: 0, data: dispatchEngine.getSubAccountMonitor() });
});

router.post("/subaccounts/:id/quota", async (req, res) => {
  await ensureDispatchEngineStarted();
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ code: "GW_400_INVALID_REQUEST", message: "subAccountId is required" });
  const quota = Math.max(0, Number(req.body?.assignmentQuota || req.body?.quota || 0));
  const sub = dispatchEngine.adjustSubAccountQuota(id, quota);
  res.json({ code: 0, data: sub });
});

router.post("/subaccounts/:id/proxy-groups", async (req, res) => {
  await ensureDispatchEngineStarted();
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ code: "GW_400_INVALID_REQUEST", message: "subAccountId is required" });
  const groups = Array.isArray(req.body?.groupIds) ? req.body.groupIds.map(String) : [];
  dispatchEngine.setSubAccountProxyGroups(id, groups);
  res.json({ code: 0, data: { subAccountId: id, groupIds: groups } });
});

router.post("/subaccounts/distribute", async (_req, res) => {
  await ensureDispatchEngineStarted();
  const all = dispatchEngine.redistributeSubAccounts();
  res.json({ code: 0, data: all });
});

router.post("/sessions/:id/circuit/open", async (req, res) => {
  await ensureDispatchEngineStarted();
  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ code: "GW_400_INVALID_REQUEST", message: "session id is required" });
  dispatchEngine.manualCircuitOpen(id, String(req.body?.reason || "manual_intervention"));
  res.json({ code: 0, data: { id, action: "open" } });
});

router.post("/sessions/:id/circuit/close", async (req, res) => {
  await ensureDispatchEngineStarted();
  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ code: "GW_400_INVALID_REQUEST", message: "session id is required" });
  dispatchEngine.manualCircuitClose(id);
  res.json({ code: 0, data: { id, action: "close" } });
});

router.post("/system/control/pause-all", async (_req, res) => {
  await ensureDispatchEngineStarted();
  dispatchEngine.pauseAll();
  res.json({ code: 0, data: { action: "pause-all" } });
});

router.post("/system/control/resume-all", async (_req, res) => {
  await ensureDispatchEngineStarted();
  dispatchEngine.resumeAll();
  res.json({ code: 0, data: { action: "resume-all" } });
});

router.post("/system/control/drain-queue", async (_req, res) => {
  await ensureDispatchEngineStarted();
  const dropped = dispatchEngine.drainQueue();
  res.json({ code: 0, data: { action: "drain-queue", dropped } });
});

export default router;
