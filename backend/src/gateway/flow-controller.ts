import { GatewayPlatform, GatewaySendResult } from "./contracts.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(private readonly capacity: number, private readonly refillPerSec: number) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefill = now;
  }

  tryTake(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  estimateWaitMs(count = 1): number {
    this.refill();
    if (this.tokens >= count) return 0;
    const deficit = count - this.tokens;
    return Math.ceil((deficit / this.refillPerSec) * 1000);
  }
}

export interface FlowControllerOptions {
  globalCapacity?: number;
  globalRefillPerSec?: number;
  platformCapacity?: Partial<Record<GatewayPlatform, number>>;
  platformRefillPerSec?: Partial<Record<GatewayPlatform, number>>;
  breakerThreshold?: number;
  breakerOpenMs?: number;
  onCircuitOpen?: (event: {
    sessionId: string;
    reason: string;
    consecutiveFailures: number;
    openedAt: number;
    reopenAt: number;
  }) => void;
}

interface BreakerState {
  consecutiveFailures: number;
  openUntil?: number;
  reason?: string;
  openedAt?: number;
}

const isXpInvalid = (result: GatewaySendResult): boolean => {
  const s = `${result.gatewayCode}|${result.upstreamCode || ""}|${result.responseBody || ""}`.toLowerCase();
  return s.includes("xp") && (s.includes("invalid") || s.includes("expired") || s.includes("fail"));
};

export class FlowController {
  private globalBucket: TokenBucket;
  private platformBuckets: Record<GatewayPlatform, TokenBucket>;
  private breaker = new Map<string, BreakerState>();
  private threshold: number;
  private openMs: number;
  private onCircuitOpen?: FlowControllerOptions["onCircuitOpen"];

  constructor(options: FlowControllerOptions = {}) {
    const globalCapacity = Math.max(1, options.globalCapacity || 30);
    const globalRefillPerSec = Math.max(1, options.globalRefillPerSec || 30);
    this.globalBucket = new TokenBucket(globalCapacity, globalRefillPerSec);
    this.platformBuckets = {
      iOS: new TokenBucket(
        Math.max(1, options.platformCapacity?.iOS || 15),
        Math.max(1, options.platformRefillPerSec?.iOS || 15)
      ),
      Android: new TokenBucket(
        Math.max(1, options.platformCapacity?.Android || 15),
        Math.max(1, options.platformRefillPerSec?.Android || 15)
      ),
    };
    this.threshold = Math.max(1, options.breakerThreshold || 5);
    this.openMs = Math.max(100, options.breakerOpenMs || 5 * 60 * 1000);
    this.onCircuitOpen = options.onCircuitOpen;
  }

  private platformKey(platform: GatewayPlatform): GatewayPlatform {
    return platform === "iOS" ? "iOS" : "Android";
  }

  async acquireDispatchPermit(platform: GatewayPlatform) {
    const key = this.platformKey(platform);
    while (true) {
      const globalOk = this.globalBucket.tryTake(1);
      const platformOk = this.platformBuckets[key].tryTake(1);
      if (globalOk && platformOk) return;

      const waitMs = Math.max(
        5,
        this.globalBucket.estimateWaitMs(1),
        this.platformBuckets[key].estimateWaitMs(1)
      );
      await sleep(waitMs);
    }
  }

  isCircuitOpen(sessionId: string): boolean {
    const state = this.breaker.get(sessionId);
    if (!state?.openUntil) return false;
    if (state.openUntil <= Date.now()) {
      state.openUntil = undefined;
      state.reason = undefined;
      state.consecutiveFailures = 0;
      this.breaker.set(sessionId, state);
      return false;
    }
    return true;
  }

  forceOpen(sessionId: string, reason = "manual_open") {
    const openedAt = Date.now();
    this.breaker.set(sessionId, {
      consecutiveFailures: this.threshold,
      openUntil: openedAt + this.openMs,
      reason,
      openedAt,
    });
    this.onCircuitOpen?.({
      sessionId,
      reason,
      consecutiveFailures: this.threshold,
      openedAt,
      reopenAt: openedAt + this.openMs,
    });
  }

  forceClose(sessionId: string) {
    this.breaker.set(sessionId, { consecutiveFailures: 0 });
  }

  getCircuitState(sessionId: string) {
    const s = this.breaker.get(sessionId);
    if (!s) return { open: false, consecutiveFailures: 0 };
    return {
      open: !!s.openUntil && s.openUntil > Date.now(),
      consecutiveFailures: s.consecutiveFailures,
      reason: s.reason,
      openedAt: s.openedAt,
      openUntil: s.openUntil,
    };
  }

  recordSuccess(sessionId: string) {
    this.breaker.set(sessionId, { consecutiveFailures: 0 });
  }

  recordFailure(sessionId: string, reason: string) {
    const current = this.breaker.get(sessionId) || { consecutiveFailures: 0 };
    current.consecutiveFailures += 1;
    current.reason = reason;
    if (current.consecutiveFailures >= this.threshold) {
      const openedAt = Date.now();
      current.openUntil = openedAt + this.openMs;
      current.openedAt = openedAt;
      this.onCircuitOpen?.({
        sessionId,
        reason,
        consecutiveFailures: current.consecutiveFailures,
        openedAt,
        reopenAt: current.openUntil,
      });
    }
    this.breaker.set(sessionId, current);
  }

  recordResult(sessionId: string, result: GatewaySendResult) {
    const shouldFail = result.status === 403 || isXpInvalid(result);
    if (shouldFail) {
      this.recordFailure(sessionId, result.status === 403 ? "http_403" : "xp_invalid");
      return;
    }
    this.recordSuccess(sessionId);
  }

  snapshotCircuit() {
    return Array.from(this.breaker.entries()).map(([sessionId, st]) => ({
      sessionId,
      consecutiveFailures: st.consecutiveFailures,
      openedAt: st.openedAt,
      openUntil: st.openUntil,
      reason: st.reason,
      open: !!st.openUntil && st.openUntil > Date.now(),
    }));
  }
}
