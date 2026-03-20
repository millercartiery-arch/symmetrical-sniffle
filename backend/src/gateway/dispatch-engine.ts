import crypto from "crypto";
import {
  DeviceProfile,
  GatewayPlatform,
  GatewaySendRequest,
  GatewaySendResult,
} from "./contracts.js";
import { FlowController } from "./flow-controller.js";
import { MessageQueueManager } from "./message-queue-manager.js";
import { SessionContext, SessionRotator } from "./session-rotator.js";
import { StatelessProtocolGatewayService } from "./service.js";
import { parseSessionPacket } from "../services/sender/stateless-sender.js";
import { TenantResourceManager } from "./tenant-resource-manager.js";
import { ProxyOrchestrator } from "./proxy-orchestrator.js";
import { EventPublisher } from "../services/event-publisher.js";

export interface QueuedDispatchTask {
  taskId?: string;
  tenantId: string;
  subAccountId?: string;
  subAccountApiKey?: string;
  priority?: number;
  preferredPlatform?: GatewayPlatform;
  requestTemplate: Omit<GatewaySendRequest, "platform" | "session">;
  localAbsolutePath?: string;
  cooldownMs?: number;
}

export interface DispatchEngineOptions {
  queueConcurrency?: number;
  defaultRetry?: number;
  onResult?: (event: {
    taskId: string;
    sessionId: string;
    profile: DeviceProfile;
    result: GatewaySendResult;
    subAccountId?: string;
  }) => void;
  onAlert?: (event: { sessionId: string; reason: string }) => void;
}

const SHADOW_FAILOVER_ENABLED = process.env.SHADOW_FAILOVER_ENABLED !== "false";
const SHADOW_FAILOVER_MAX_ATTEMPTS = Math.max(
  0,
  Math.min(2, Number(process.env.SHADOW_FAILOVER_MAX_ATTEMPTS || 1))
);
const SHADOW_FAILOVER_COOLDOWN_MS = Math.max(
  0,
  Number(process.env.SHADOW_FAILOVER_COOLDOWN_MS || 120000)
);

type ShadowFailoverEvent = {
  ts: number;
  taskId: string;
  tenantId: string;
  subAccountId?: string;
  trigger: "result" | "error";
  triggerReason: string;
  primarySessionId: string;
  primaryStatus?: number;
  primaryGatewayCode?: string;
  shadowSessionId?: string;
  shadowStatus?: number;
  shadowGatewayCode?: string;
  success: boolean;
};

export class DispatchEngine {
  readonly queue: MessageQueueManager<QueuedDispatchTask>;
  readonly rotator: SessionRotator;
  readonly flow: FlowController;
  readonly tenantManager: TenantResourceManager;
  readonly proxyOrchestrator: ProxyOrchestrator;
  private service: StatelessProtocolGatewayService;
  private onResult?: DispatchEngineOptions["onResult"];
  private onAlert?: DispatchEngineOptions["onAlert"];
  private metrics = {
    startedAt: Date.now(),
    totalSent: 0,
    totalSuccess: 0,
    totalFailed: 0,
    perPlatform: {
      iOS: { success: 0, failed: 0 },
      Android: { success: 0, failed: 0 },
    },
    recentResults: [] as Array<{ ts: number; platform: GatewayPlatform; ok: boolean }>,
    alerts: [] as Array<{ ts: number; sessionId: string; reason: string }>,
    shadowEvents: [] as ShadowFailoverEvent[],
    logs: [] as Array<{
      ts: number;
      taskId: string;
      sessionId: string;
      subAccountId?: string;
      platform: GatewayPlatform;
      ok: boolean;
      status: number;
      gatewayCode: string;
    }>,
  };
  private statCache: { ts: number; data: any } = { ts: 0, data: null };

  constructor(options: DispatchEngineOptions = {}) {
    this.queue = new MessageQueueManager<QueuedDispatchTask>({
      concurrency: Math.max(1, options.queueConcurrency || 8),
      defaultMaxAttempts: Math.max(1, options.defaultRetry || 3),
    });
    this.rotator = new SessionRotator();
    this.tenantManager = new TenantResourceManager();
    this.flow = new FlowController({
      onCircuitOpen: (event) => {
        this.rotator.pause(event.sessionId, `circuit_open:${event.reason}`);
        this.metrics.alerts.push({ ts: Date.now(), sessionId: event.sessionId, reason: event.reason });
        if (this.metrics.alerts.length > 200) this.metrics.alerts.shift();
        this.onAlert?.({ sessionId: event.sessionId, reason: event.reason });
      },
    });
    this.service = new StatelessProtocolGatewayService();
    this.proxyOrchestrator = new ProxyOrchestrator({
      onAlert: (event) => this.metrics.alerts.push({ ts: Date.now(), sessionId: event.proxyId, reason: `proxy:${event.reason}` }),
    });
    this.proxyOrchestrator.startHeartbeat(60_000);
    this.onResult = options.onResult;
    this.onAlert = options.onAlert;
  }

  registerSessionContexts(contexts: Array<Omit<SessionContext, "paused" | "inUse">>) {
    this.rotator.registerBatch(contexts);
    this.refreshGlobalPoolFromRotator();
  }

  importSessionsFromRaw(rawText: string, defaultCooldownMs = 30000, maxLines = 10000) {
    const lines = String(rawText || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > maxLines) {
      throw new Error(`too many lines: ${lines.length}, max=${maxLines}`);
    }
    const imported: string[] = [];
    const failed: Array<{ line: number; reason: string }> = [];

    lines.forEach((line, idx) => {
      try {
        const obj = JSON.parse(line);
        const session = parseSessionPacket(obj);
        const platform = session.os === "iOS" ? "iOS" : "Android";
        const id =
          String((obj as any)?.sessionContextId || (obj as any)?.phone || (obj as any)?.username || "") ||
          crypto.randomUUID();
        this.rotator.upsert({
          id,
          platform,
          profile: {
            platform,
            model: String((obj as any)?.["X-PX-DEVICE-MODEL"] || (obj as any)?.model || ""),
            osVersion: String((obj as any)?.["X-PX-OS-VERSION"] || (obj as any)?.osVersion || ""),
            userAgent: String((obj as any)?.["User-Agent"] || (obj as any)?.userAgent || ""),
            sessionPx: String((obj as any)?.["X-PX-AUTHORIZATION"] || ""),
            hardwareFingerprint: String((obj as any)?.["X-PX-DEVICE-FP"] || (obj as any)?.fp || ""),
          },
          session,
          cooldownMs: defaultCooldownMs,
        });
        imported.push(id);
      } catch (err: any) {
        failed.push({ line: idx + 1, reason: err?.message || "invalid_json" });
      }
    });
    this.refreshGlobalPoolFromRotator();
    return { total: lines.length, imported: imported.length, failed: failed.length, importedIds: imported, failedLines: failed };
  }

  createSubAccounts(count: number, perAccount: number) {
    const created = this.tenantManager.createSubAccounts(count, perAccount);
    return created;
  }

  adjustSubAccountQuota(subAccountId: string, quota: number) {
    this.tenantManager.upsertSubAccount({
      subAccountId,
      assignmentQuota: quota,
    });
    return this.tenantManager.getSubAccount(subAccountId);
  }

  redistributeSubAccounts() {
    this.tenantManager.redistribute();
    return this.tenantManager.listSubAccounts();
  }

  setSubAccountProxyGroups(subAccountId: string, groupIds: string[]) {
    this.proxyOrchestrator.setSubAccountProxyGroups(subAccountId, groupIds);
  }

  upsertProxyNodes(items: Array<{ protocol: string; host: string; port: number; groupId?: string; isp?: string; region?: string; country?: string; username?: string; password?: string }>) {
    this.proxyOrchestrator.upsertProxyNodes(items);
  }

  configureProxyFetcher(config: { apiUrl: string; intervalMinutes: number; authHeader?: string }) {
    this.proxyOrchestrator.configureFetcher(config);
  }

  configureProxyWhitelist(config: { apiUrl: string; authHeader?: string }) {
    this.proxyOrchestrator.configureWhitelist(config);
  }

  async updateProxyWhitelist(serverIp: string) {
    await this.proxyOrchestrator.updateWhitelist(serverIp);
  }

  async refreshProxyFetcherNow() {
    return await this.proxyOrchestrator.refreshFromFetcherOnce();
  }

  getProxyFetcherConfig() {
    return this.proxyOrchestrator.getFetcherConfig();
  }

  getProxyWhitelistConfig() {
    return this.proxyOrchestrator.getWhitelistConfig();
  }

  submit(task: QueuedDispatchTask) {
    return this.queue.enqueue(task, { taskId: task.taskId, priority: Number(task.priority || 0) });
  }

  submitBatch(tasks: QueuedDispatchTask[]) {
    return this.queue.enqueueBatch(
      tasks.map((t) => ({
        payload: t,
        taskId: t.taskId,
        priority: Number(t.priority || 0),
      }))
    );
  }

  async start() {
    await this.queue.start(async ({ task }) => {
      const payload = task.payload;
      const taskId = payload.taskId || task.id || crypto.randomUUID();
      if (payload.subAccountId) {
        if (!this.tenantManager.validateApiKey(payload.subAccountId, payload.subAccountApiKey)) {
          return { ok: false, retry: false };
        }
      }

      const scopedIds = payload.subAccountId
        ? this.tenantManager.getAssignedSessionIds(payload.subAccountId)
        : [];
      if (payload.subAccountId && scopedIds.length === 0) {
        return { ok: false, retry: false };
      }
      const acquireSessionCandidate = (excludedSessionIds: string[] = []) =>
        scopedIds.length > 0
          ? this.rotator.acquireNextScoped(scopedIds, {
              preferredPlatform: payload.preferredPlatform,
              allowPlatformFallback: true,
              excludedSessionIds,
            })
          : this.rotator.acquireNext({
              preferredPlatform: payload.preferredPlatform,
              allowPlatformFallback: true,
              excludedSessionIds,
            });
      const session = acquireSessionCandidate();
      if (!session) {
        return { ok: false, retry: true, delayMs: 30 };
      }

      const executeAttempt = async (activeSession: SessionContext) => {
        let acquiredProxyId: string | null = null;
        try {
          if (this.flow.isCircuitOpen(activeSession.id)) {
            this.flow.recordFailure(activeSession.id, "circuit_open");
            return { error: new Error("circuit_open") };
          }

          await this.flow.acquireDispatchPermit(activeSession.platform);
          const geoHint =
            String((activeSession.session as any)?.registrationGeo || (activeSession.profile as any)?.country || "").trim() ||
            undefined;
          const proxy = this.proxyOrchestrator.acquireProxy({
            sessionContextId: activeSession.id,
            subAccountId: payload.subAccountId,
            geoHint,
          });
          if (!proxy) {
            this.flow.recordFailure(activeSession.id, "proxy_unavailable");
            return { error: new Error("proxy_unavailable") };
          }
          acquiredProxyId = proxy.id;

          const request: GatewaySendRequest = {
            ...payload.requestTemplate,
            tenantId: payload.tenantId,
            platform: activeSession.platform,
            session: activeSession.session,
            extraHeaders: {
              ...(payload.requestTemplate.extraHeaders || {}),
              "x-egress-proxy-id": proxy.id,
              "x-egress-proxy-group": String(proxy.groupId || ""),
              "x-egress-proxy-url": `${proxy.protocol}://${proxy.host}:${proxy.port}`,
            },
          };

          const result = await this.service.sendDispatched({
            request,
            profile: activeSession.profile,
            localAbsolutePath: payload.localAbsolutePath,
          });

          this.flow.recordResult(activeSession.id, result);
          this.proxyOrchestrator.recordSendResult(proxy.id, {
            ok: result.ok,
            status: result.status,
            latencyMs: result.latencyMs,
            timeout: result.status === 504,
          });
          return { result };
        } catch (error: any) {
          this.flow.recordFailure(activeSession.id, "transport_exception");
          if (acquiredProxyId) {
            this.proxyOrchestrator.recordSendResult(acquiredProxyId, {
              ok: false,
              status: 599,
              timeout: true,
            });
          }
          return { error };
        } finally {
          if (acquiredProxyId) {
            this.proxyOrchestrator.releaseProxy(acquiredProxyId);
          }
          this.rotator.release(activeSession.id, {
            cooldownMs: this.withJitter(payload.cooldownMs ?? activeSession.cooldownMs),
          });
        }
      };

      let finalSession = session;
      let finalResult: GatewaySendResult | null = null;
      let finalError: any = null;
      const triedSessionIds = [session.id];

      const primaryAttempt = await executeAttempt(session);
      finalResult = primaryAttempt.result || null;
      finalError = primaryAttempt.error || null;

      if (
        SHADOW_FAILOVER_ENABLED &&
        SHADOW_FAILOVER_MAX_ATTEMPTS > 0 &&
        this.shouldTriggerShadowFailover(finalResult, finalError)
      ) {
        this.rotator.markCooldown(session.id, SHADOW_FAILOVER_COOLDOWN_MS);
        const trigger = this.buildShadowTrigger(finalResult, finalError);

        for (let i = 0; i < SHADOW_FAILOVER_MAX_ATTEMPTS; i++) {
          const shadowSession = acquireSessionCandidate(triedSessionIds);
          if (!shadowSession) {
            this.recordShadowFailoverEvent({
              ts: Date.now(),
              taskId,
              tenantId: payload.tenantId,
              subAccountId: payload.subAccountId,
              trigger: trigger.type,
              triggerReason: trigger.reason,
              primarySessionId: session.id,
              primaryStatus: finalResult?.status,
              primaryGatewayCode: finalResult?.gatewayCode,
              success: false,
            });
            break;
          }

          triedSessionIds.push(shadowSession.id);
          const shadowAttempt = await executeAttempt(shadowSession);
          finalSession = shadowSession;
          finalResult = shadowAttempt.result || null;
          finalError = shadowAttempt.error || null;
          const shadowOk = !!finalResult?.ok;

          this.recordShadowFailoverEvent({
            ts: Date.now(),
            taskId,
            tenantId: payload.tenantId,
            subAccountId: payload.subAccountId,
            trigger: trigger.type,
            triggerReason: trigger.reason,
            primarySessionId: session.id,
            primaryStatus: primaryAttempt.result?.status,
            primaryGatewayCode: primaryAttempt.result?.gatewayCode,
            shadowSessionId: shadowSession.id,
            shadowStatus: finalResult?.status,
            shadowGatewayCode: finalResult?.gatewayCode,
            success: shadowOk,
          });

          if (shadowOk || !this.shouldTriggerShadowFailover(finalResult, finalError)) {
            break;
          }
        }
      }

      if (finalResult) {
        this.recordMetric(finalSession.platform, finalResult.ok);
        this.recordLog({
          taskId,
          sessionId: finalSession.id,
          subAccountId: payload.subAccountId,
          platform: finalSession.platform,
          ok: finalResult.ok,
          status: finalResult.status,
          gatewayCode: finalResult.gatewayCode,
        });
        this.onResult?.({
          taskId,
          sessionId: finalSession.id,
          profile: finalSession.profile,
          result: finalResult,
          subAccountId: payload.subAccountId,
        });

        if (!finalResult.ok && finalResult.retryable) {
          return { ok: false, retry: true, delayMs: 80 };
        }
        return { ok: finalResult.ok, retry: false };
      }

      this.recordMetric(finalSession.platform, false);
      this.recordLog({
        taskId,
        sessionId: finalSession.id,
        subAccountId: payload.subAccountId,
        platform: finalSession.platform,
        ok: false,
        status: 599,
        gatewayCode: String(finalError?.code || "GW_599_SHADOW_FAILOVER_EXHAUSTED"),
      });
      return { ok: false, retry: true, delayMs: 120 };
    });
  }

  async stop() {
    await this.queue.stop();
    this.proxyOrchestrator.stopHeartbeat();
    this.proxyOrchestrator.stopFetcher();
  }

  pauseAll() {
    this.queue.pauseConsume();
    this.rotator.snapshot().forEach((s) => this.rotator.pause(s.id, "global_pause"));
  }

  resumeAll() {
    this.rotator.snapshot().forEach((s) => this.rotator.resume(s.id));
    this.queue.resumeConsume();
  }

  drainQueue() {
    return this.queue.clearQueue();
  }

  private shouldTriggerShadowFailover(result?: GatewaySendResult | null, error?: unknown): boolean {
    if (error) return true;
    if (!result || result.ok) return false;
    if (result.retryable) return true;
    if ([403, 429, 500, 502, 503, 504].includes(result.status)) return true;
    const code = String(result.gatewayCode || "");
    return code.includes("TRANSPORT_") || code.includes("UPSTREAM_");
  }

  private buildShadowTrigger(result?: GatewaySendResult | null, error?: unknown) {
    if (error) {
      return {
        type: "error" as const,
        reason: String((error as any)?.message || (error as any)?.code || "runtime_error"),
      };
    }
    return {
      type: "result" as const,
      reason: `${String(result?.gatewayCode || "unknown")}#${Number(result?.status || 0)}`,
    };
  }

  private recordShadowFailoverEvent(event: ShadowFailoverEvent) {
    this.metrics.shadowEvents.push(event);
    if (this.metrics.shadowEvents.length > 1000) this.metrics.shadowEvents.shift();
    this.metrics.alerts.push({
      ts: event.ts,
      sessionId: event.shadowSessionId || event.primarySessionId,
      reason: `shadow_failover:${event.triggerReason}:${event.success ? "success" : "failed"}`,
    });
    if (this.metrics.alerts.length > 200) this.metrics.alerts.shift();
    EventPublisher.publishShadowFailover(event).catch(() => undefined);
  }

  private recordMetric(platform: GatewayPlatform, ok: boolean) {
    this.metrics.totalSent += 1;
    if (ok) this.metrics.totalSuccess += 1;
    else this.metrics.totalFailed += 1;
    if (ok) this.metrics.perPlatform[platform].success += 1;
    else this.metrics.perPlatform[platform].failed += 1;
    this.metrics.recentResults.push({ ts: Date.now(), platform, ok });
    const cutoff = Date.now() - 5 * 60 * 1000;
    while (this.metrics.recentResults.length && this.metrics.recentResults[0].ts < cutoff) {
      this.metrics.recentResults.shift();
    }
  }

  private recordLog(log: {
    taskId: string;
    sessionId: string;
    subAccountId?: string;
    platform: GatewayPlatform;
    ok: boolean;
    status: number;
    gatewayCode: string;
  }) {
    this.metrics.logs.push({ ts: Date.now(), ...log });
    if (this.metrics.logs.length > 5000) this.metrics.logs.shift();
  }

  getSystemStats() {
    if (Date.now() - this.statCache.ts < 1000 && this.statCache.data) {
      return this.statCache.data;
    }
    const now = Date.now();
    const windowSec = 10;
    const cutoff = now - windowSec * 1000;
    const recent = this.metrics.recentResults.filter((r) => r.ts >= cutoff);
    const qps = Number((recent.length / windowSec).toFixed(2));

    const iosTotal = this.metrics.perPlatform.iOS.success + this.metrics.perPlatform.iOS.failed;
    const androidTotal = this.metrics.perPlatform.Android.success + this.metrics.perPlatform.Android.failed;
    const iosSuccessRate = iosTotal ? Number((this.metrics.perPlatform.iOS.success / iosTotal * 100).toFixed(2)) : 0;
    const androidSuccessRate = androidTotal
      ? Number((this.metrics.perPlatform.Android.success / androidTotal * 100).toFixed(2))
      : 0;

    const data = {
      runtime: {
        startedAt: this.metrics.startedAt,
        uptimeSec: Math.floor((now - this.metrics.startedAt) / 1000),
      },
      queue: this.queue.stats(),
      throughput: {
        qps,
        totalSent: this.metrics.totalSent,
        totalSuccess: this.metrics.totalSuccess,
        totalFailed: this.metrics.totalFailed,
      },
      platformSuccessRate: {
        iOS: iosSuccessRate,
        Android: androidSuccessRate,
      },
      circuit: this.flow.snapshotCircuit(),
      alerts: this.metrics.alerts.slice(-20).reverse(),
      shadowFailoverRecent: this.metrics.shadowEvents.slice(-20).reverse(),
      proxy: this.proxyOrchestrator.getStats(),
    };
    this.statCache = { ts: Date.now(), data };
    return data;
  }

  getSessionStates() {
    return this.rotator.snapshot().map((s) => {
      const circuit = this.flow.getCircuitState(s.id);
      const now = Date.now();
      const cooldown = s.cooldownUntil && s.cooldownUntil > now;
      let state = "Active";
      if (circuit.open) state = "Circuit-Open";
      else if (cooldown) state = "Cooldown";
      else if (s.paused) state = "Paused";
      return {
        id: s.id,
        platform: s.platform,
        state,
        inUse: s.inUse,
        paused: s.paused,
        pauseReason: s.pauseReason,
        cooldownUntil: s.cooldownUntil,
        cooldownRemainingMs: cooldown ? s.cooldownUntil! - now : 0,
        model: s.profile.model,
        osVersion: s.profile.osVersion,
      };
    });
  }

  getSubAccountMonitor() {
    const sessions = this.getSessionStates();
    const mapById = new Map(sessions.map((s) => [s.id, s]));
    return this.tenantManager.listSubAccounts().map((sub) => {
      const assigned = sub.assignedSessionIds;
      const assignedStates = assigned
        .map((id) => mapById.get(id))
        .filter(Boolean) as Array<ReturnType<DispatchEngine["getSessionStates"]>[number]>;
      const online = assignedStates.filter((s) => s.state !== "Circuit-Open" && !s.paused).length;
      const running = assignedStates.filter((s) => s.inUse).length;
      return {
        subAccountId: sub.subAccountId,
        apiKey: sub.apiKey,
        assignmentQuota: sub.assignmentQuota,
        assignedTotal: assigned.length,
        online,
        running,
        assignedSessionIds: assigned,
      };
    });
  }

  getDispatchLogs(filter?: { subAccountId?: string; limit?: number }) {
    const all = this.metrics.logs;
    const scoped = filter?.subAccountId
      ? all.filter((l) => l.subAccountId === filter.subAccountId)
      : all;
    const limit = Math.max(1, Math.min(1000, Number(filter?.limit || 100)));
    return scoped.slice(-limit).reverse();
  }

  getShadowFailoverEvents(limit = 100) {
    const cap = Math.max(1, Math.min(1000, Number(limit || 100)));
    return this.metrics.shadowEvents.slice(-cap).reverse();
  }

  getProxyCenter() {
    return {
      stats: this.proxyOrchestrator.getStats(),
      badDebt: this.proxyOrchestrator.exportBadDebt(),
    };
  }

  exportBadDebtIps() {
    return this.proxyOrchestrator.exportBadDebt();
  }

  manualCircuitOpen(sessionId: string, reason = "manual_open") {
    this.flow.forceOpen(sessionId, reason);
    this.rotator.pause(sessionId, `manual_circuit_open:${reason}`);
  }

  manualCircuitClose(sessionId: string) {
    this.flow.forceClose(sessionId);
    this.rotator.resume(sessionId);
  }

  private withJitter(baseMs: number) {
    const base = Math.max(0, baseMs || 0);
    if (!base) return 0;
    const factor = 0.8 + Math.random() * 0.5; // 0.8 ~ 1.3
    return Math.round(base * factor);
  }

  private refreshGlobalPoolFromRotator() {
    const ids = this.rotator.snapshot().map((s) => s.id);
    this.tenantManager.setGlobalSessionPool(ids);
  }
}
