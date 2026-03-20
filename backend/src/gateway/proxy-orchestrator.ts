import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

export type ProxyStatus = "Online" | "Suspended" | "Removed";

export interface ProxyNode {
  id: string;
  protocol: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  isp?: string;
  region?: string;
  country?: string;
  groupId?: string;
  status: ProxyStatus;
  score: number;
  rttMsAvg: number;
  successes: number;
  failures: number;
  consecutiveTimeouts: number;
  consecutiveRejected: number;
  suspendedUntil?: number;
  lastCheckAt?: number;
  currentConnections: number;
}

interface StickyBinding {
  proxyId: string;
  subAccountId?: string;
  expiresAt: number;
}

export interface ProxyFetchConfig {
  apiUrl: string;
  intervalMinutes: number;
  authHeader?: string;
}

export interface ProxyWhitelistConfig {
  apiUrl: string;
  authHeader?: string;
}

export class ProxyOrchestrator {
  private proxies = new Map<string, ProxyNode>();
  private sticky = new Map<string, StickyBinding>();
  private subAccountGroups = new Map<string, Set<string>>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private fetchTimer: NodeJS.Timeout | null = null;
  private fetchConfig: ProxyFetchConfig | null = null;
  private whitelistConfig: ProxyWhitelistConfig | null = null;
  private readonly stickyMs = 24 * 60 * 60 * 1000;
  private readonly suspendMs = 30 * 60 * 1000;

  constructor(private readonly options?: {
    heartbeatUrl?: string;
    onAlert?: (event: { proxyId: string; reason: string }) => void;
    onFetcherUpdate?: (count: number) => void;
    whitelistUpdater?: (serverIp: string) => Promise<void> | void;
  }) {}

  private keyOf(p: { protocol: string; host: string; port: number }) {
    return `${p.protocol}://${p.host}:${p.port}`;
  }

  upsertProxyNodes(items: Array<Partial<ProxyNode> & { protocol: string; host: string; port: number }>) {
    for (const item of items) {
      const id = String(item.id || this.keyOf(item as any));
      const prev = this.proxies.get(id);
      const node: ProxyNode = {
        id,
        protocol: item.protocol || prev?.protocol || "http",
        host: item.host || prev?.host || "",
        port: Number(item.port || prev?.port || 0),
        username: item.username ?? prev?.username,
        password: item.password ?? prev?.password,
        isp: item.isp ?? prev?.isp,
        region: item.region ?? prev?.region,
        country: item.country ?? prev?.country,
        groupId: item.groupId ?? prev?.groupId,
        status: item.status || prev?.status || "Online",
        score: Number(item.score ?? prev?.score ?? 100),
        rttMsAvg: Number(item.rttMsAvg ?? prev?.rttMsAvg ?? 0),
        successes: Number(item.successes ?? prev?.successes ?? 0),
        failures: Number(item.failures ?? prev?.failures ?? 0),
        consecutiveTimeouts: Number(item.consecutiveTimeouts ?? prev?.consecutiveTimeouts ?? 0),
        consecutiveRejected: Number(item.consecutiveRejected ?? prev?.consecutiveRejected ?? 0),
        suspendedUntil: item.suspendedUntil ?? prev?.suspendedUntil,
        lastCheckAt: item.lastCheckAt ?? prev?.lastCheckAt,
        currentConnections: Number(item.currentConnections ?? prev?.currentConnections ?? 0),
      };
      if (!node.host || !node.port) continue;
      this.proxies.set(id, node);
    }
  }

  setSubAccountProxyGroups(subAccountId: string, groupIds: string[]) {
    this.subAccountGroups.set(subAccountId, new Set(groupIds.filter(Boolean)));
  }

  private matchesSubAccountGroup(proxy: ProxyNode, subAccountId?: string) {
    if (!subAccountId) return true;
    const groups = this.subAccountGroups.get(subAccountId);
    if (!groups || groups.size === 0) return true;
    return !!proxy.groupId && groups.has(proxy.groupId);
  }

  private matchesGeo(proxy: ProxyNode, geoHint?: string) {
    if (!geoHint) return true;
    const hint = geoHint.toLowerCase();
    return [proxy.region, proxy.country, proxy.isp].some((x) => String(x || "").toLowerCase().includes(hint));
  }

  acquireProxy(input: { sessionContextId: string; subAccountId?: string; geoHint?: string }) {
    const now = Date.now();
    const sticky = this.sticky.get(input.sessionContextId);
    if (sticky && sticky.expiresAt > now) {
      const bound = this.proxies.get(sticky.proxyId);
      if (bound && bound.status === "Online" && this.matchesSubAccountGroup(bound, input.subAccountId)) {
        bound.currentConnections += 1;
        return bound;
      }
    }

    const all = Array.from(this.proxies.values()).filter(
      (p) =>
        p.status === "Online" &&
        this.matchesSubAccountGroup(p, input.subAccountId) &&
        this.matchesGeo(p, input.geoHint)
    );
    const candidates = all.length
      ? all
      : Array.from(this.proxies.values()).filter(
          (p) => p.status === "Online" && this.matchesSubAccountGroup(p, input.subAccountId)
        );
    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.currentConnections - b.currentConnections;
    });
    const pick = candidates[0];
    pick.currentConnections += 1;
    this.sticky.set(input.sessionContextId, {
      proxyId: pick.id,
      subAccountId: input.subAccountId,
      expiresAt: now + this.stickyMs,
    });
    return pick;
  }

  releaseProxy(proxyId: string) {
    const p = this.proxies.get(proxyId);
    if (!p) return;
    p.currentConnections = Math.max(0, p.currentConnections - 1);
  }

  recordSendResult(proxyId: string, result: { ok: boolean; status: number; latencyMs?: number; timeout?: boolean }) {
    const p = this.proxies.get(proxyId);
    if (!p) return;
    p.lastCheckAt = Date.now();
    const latency = Math.max(1, Number(result.latencyMs || 0));
    if (result.ok) {
      p.successes += 1;
      p.consecutiveRejected = 0;
      p.consecutiveTimeouts = 0;
      p.score = Math.min(100, p.score + 1);
      p.rttMsAvg = p.rttMsAvg ? Math.round((p.rttMsAvg * 0.8 + latency * 0.2)) : latency;
      return;
    }

    p.failures += 1;
    if (result.timeout) p.consecutiveTimeouts += 1;
    if (result.status === 403 || result.status === 429 || result.status === 407) p.consecutiveRejected += 1;
    p.score = Math.max(0, p.score - 8);
    if (latency) p.rttMsAvg = p.rttMsAvg ? Math.round((p.rttMsAvg * 0.85 + latency * 0.15)) : latency;

    if (p.consecutiveTimeouts >= 3 || p.consecutiveRejected >= 3) {
      p.status = "Suspended";
      p.suspendedUntil = Date.now() + this.suspendMs;
      this.options?.onAlert?.({
        proxyId: p.id,
        reason: p.consecutiveTimeouts >= 3 ? "timeout_x3" : "rejected_x3",
      });
    }
  }

  private async probeProxy(p: ProxyNode): Promise<boolean> {
    const target = this.options?.heartbeatUrl || "https://www.google.com";
    const proxyUrl = `${p.protocol}://${p.username ? `${p.username}:${p.password}@` : ""}${p.host}:${p.port}`;
    const agent = new HttpsProxyAgent(proxyUrl);
    const start = Date.now();
    try {
      await axios.get(target, { httpsAgent: agent, timeout: 7000, validateStatus: () => true });
      const rtt = Date.now() - start;
      p.rttMsAvg = p.rttMsAvg ? Math.round((p.rttMsAvg * 0.8 + rtt * 0.2)) : rtt;
      return true;
    } catch {
      return false;
    }
  }

  async runHeartbeatOnce() {
    const now = Date.now();
    for (const p of this.proxies.values()) {
      if (p.status !== "Suspended") continue;
      if ((p.suspendedUntil || 0) > now) continue;
      const ok = await this.probeProxy(p);
      if (ok) {
        p.status = "Online";
        p.suspendedUntil = undefined;
        p.consecutiveRejected = 0;
        p.consecutiveTimeouts = 0;
        p.score = Math.max(50, p.score);
      } else {
        p.status = "Removed";
      }
    }
  }

  startHeartbeat(intervalMs = 60_000) {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.runHeartbeatOnce().catch(() => undefined);
    }, Math.max(10_000, intervalMs));
  }

  stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  async refreshFromFetcherOnce() {
    if (!this.fetchConfig) return 0;
    const headers: Record<string, string> = {};
    if (this.fetchConfig.authHeader) headers.authorization = this.fetchConfig.authHeader;
    const res = await axios.get(this.fetchConfig.apiUrl, {
      headers,
      timeout: 10000,
      validateStatus: () => true,
    });
    const parsed = this.parseFetcherPayload(res.data);
    this.upsertProxyNodes(parsed);
    this.options?.onFetcherUpdate?.(parsed.length);
    return parsed.length;
  }

  private parseFetcherPayload(payload: unknown) {
    const out: Array<{ protocol: string; host: string; port: number; username?: string; password?: string }> = [];
    const pushNode = (node: { protocol?: unknown; host?: unknown; port?: unknown; username?: unknown; password?: unknown }) => {
      const protocol = String(node.protocol || "http").trim() || "http";
      const host = String(node.host || "").trim();
      const port = Number(node.port || 0);
      const username = node.username != null ? String(node.username) : undefined;
      const password = node.password != null ? String(node.password) : undefined;
      if (!host || !Number.isFinite(port) || port <= 0) return;
      out.push({ protocol, host, port, username, password });
    };

    const parseLine = (lineRaw: string) => {
      const line = String(lineRaw || "").trim();
      if (!line) return;
      try {
        if (line.startsWith("[")) {
          const arr = JSON.parse(line);
          for (const node of this.parseFetcherPayload(arr)) out.push(node);
          return;
        }
        if (line.startsWith("{")) {
          const obj = JSON.parse(line);
          pushNode(obj);
          return;
        }
        if (line.includes("://")) {
          const url = new URL(line);
          pushNode({
            protocol: url.protocol.replace(":", ""),
            host: url.hostname,
            port: Number(url.port || 0),
            username: url.username || undefined,
            password: url.password || undefined,
          });
          return;
        }
        const parts = line.split(":");
        if (parts.length >= 2) {
          const host = parts[0];
          const port = Number(parts[1] || 0);
          const username = parts.length >= 3 ? parts[2] : undefined;
          const password = parts.length >= 4 ? parts[3] : undefined;
          pushNode({ protocol: "http", host, port, username, password });
        }
      } catch {
        // ignore bad line
      }
    };

    if (Array.isArray(payload)) {
      for (const item of payload) {
        if (typeof item === "string") parseLine(item);
        else if (item && typeof item === "object") pushNode(item as any);
      }
      return out;
    }

    if (payload && typeof payload === "object") {
      const maybeObj = payload as any;
      if (Array.isArray(maybeObj.data)) {
        return this.parseFetcherPayload(maybeObj.data);
      }
      if (maybeObj.host || maybeObj.port) {
        pushNode(maybeObj);
        return out;
      }
      const nestedList = ["items", "list", "proxies"]
        .map((k) => maybeObj[k])
        .find((v) => Array.isArray(v));
      if (nestedList) {
        return this.parseFetcherPayload(nestedList);
      }
    }

    const body = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
    const lines = body
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const line of lines) parseLine(line);
    return out;
  }

  configureFetcher(config: ProxyFetchConfig) {
    this.fetchConfig = {
      ...config,
      intervalMinutes: Math.max(1, Number(config.intervalMinutes || 5)),
    };
    this.restartFetcher();
  }

  private restartFetcher() {
    if (this.fetchTimer) {
      clearInterval(this.fetchTimer);
      this.fetchTimer = null;
    }
    if (!this.fetchConfig) return;
    const ms = this.fetchConfig.intervalMinutes * 60 * 1000;
    this.fetchTimer = setInterval(() => {
      this.refreshFromFetcherOnce().catch(() => undefined);
    }, ms);
  }

  stopFetcher() {
    if (!this.fetchTimer) return;
    clearInterval(this.fetchTimer);
    this.fetchTimer = null;
  }

  async updateWhitelist(serverIp: string) {
    if (this.options?.whitelistUpdater) {
      await this.options.whitelistUpdater(serverIp);
      return;
    }
    if (!this.whitelistConfig) return;
    const headers: Record<string, string> = {};
    if (this.whitelistConfig.authHeader) headers.authorization = this.whitelistConfig.authHeader;
    await axios.post(
      this.whitelistConfig.apiUrl,
      { serverIp },
      { headers, timeout: 10000, validateStatus: () => true }
    );
  }

  configureWhitelist(config: ProxyWhitelistConfig) {
    this.whitelistConfig = {
      apiUrl: String(config.apiUrl || "").trim(),
      authHeader: config.authHeader,
    };
  }

  getFetcherConfig(): ProxyFetchConfig | null {
    return this.fetchConfig ? { ...this.fetchConfig } : null;
  }

  getWhitelistConfig(): ProxyWhitelistConfig | null {
    return this.whitelistConfig ? { ...this.whitelistConfig } : null;
  }

  snapshot() {
    return Array.from(this.proxies.values());
  }

  exportBadDebt() {
    return this.snapshot()
      .filter((p) => {
        const total = p.successes + p.failures;
        const failRate = total ? p.failures / total : 0;
        return failRate >= 0.5 || p.status === "Removed";
      })
      .map((p) => ({
        id: p.id,
        host: p.host,
        port: p.port,
        isp: p.isp,
        region: p.region,
        country: p.country,
        status: p.status,
        failRate:
          p.successes + p.failures
            ? Number((p.failures / (p.successes + p.failures)).toFixed(4))
            : 0,
      }));
  }

  getStats() {
    const list = this.snapshot();
    const byRegion: Record<string, number> = {};
    const byIsp: Record<string, number> = {};
    for (const p of list) {
      byRegion[p.region || "unknown"] = (byRegion[p.region || "unknown"] || 0) + 1;
      byIsp[p.isp || "unknown"] = (byIsp[p.isp || "unknown"] || 0) + 1;
    }
    const online = list.filter((p) => p.status === "Online");
    const avgRtt = online.length
      ? Math.round(online.reduce((a, b) => a + (b.rttMsAvg || 0), 0) / online.length)
      : 0;
    return {
      total: list.length,
      online: online.length,
      suspended: list.filter((p) => p.status === "Suspended").length,
      removed: list.filter((p) => p.status === "Removed").length,
      avgRtt,
      byRegion,
      byIsp,
      list,
    };
  }
}
