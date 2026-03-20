import { DeviceProfile, GatewayPlatform, GatewaySessionEnvelope } from "./contracts.js";

export interface SessionContext {
  id: string;
  platform: GatewayPlatform;
  profile: DeviceProfile;
  session: GatewaySessionEnvelope;
  cooldownMs: number;
  paused: boolean;
  pauseReason?: string;
  pausedAt?: number;
  lastUsedAt?: number;
  cooldownUntil?: number;
  inUse: boolean;
}

export interface AcquireSessionOptions {
  preferredPlatform?: GatewayPlatform;
  allowPlatformFallback?: boolean;
  allowedSessionIds?: string[];
  excludedSessionIds?: string[];
}

export class SessionRotator {
  private pool: SessionContext[] = [];
  private cursor = 0;

  upsert(context: Omit<SessionContext, "paused" | "inUse"> & Partial<Pick<SessionContext, "paused" | "inUse">>) {
    const idx = this.pool.findIndex((p) => p.id === context.id);
    const normalized: SessionContext = {
      ...context,
      paused: context.paused ?? false,
      inUse: context.inUse ?? false,
      cooldownMs: Math.max(0, context.cooldownMs || 0),
    };
    if (idx === -1) this.pool.push(normalized);
    else this.pool[idx] = normalized;
  }

  registerBatch(contexts: Array<Omit<SessionContext, "paused" | "inUse"> & Partial<Pick<SessionContext, "paused" | "inUse">>>) {
    contexts.forEach((c) => this.upsert(c));
  }

  pause(id: string, reason = "manual_pause") {
    const s = this.pool.find((p) => p.id === id);
    if (!s) return false;
    s.paused = true;
    s.pauseReason = reason;
    s.pausedAt = Date.now();
    return true;
  }

  resume(id: string) {
    const s = this.pool.find((p) => p.id === id);
    if (!s) return false;
    s.paused = false;
    s.pauseReason = undefined;
    s.pausedAt = undefined;
    return true;
  }

  markCooldown(id: string, cooldownMs?: number) {
    const s = this.pool.find((p) => p.id === id);
    if (!s) return false;
    const ms = Math.max(0, cooldownMs ?? s.cooldownMs);
    s.cooldownUntil = Date.now() + ms;
    s.lastUsedAt = Date.now();
    return true;
  }

  release(id: string, opts?: { cooldownMs?: number }) {
    const s = this.pool.find((p) => p.id === id);
    if (!s) return false;
    s.inUse = false;
    this.markCooldown(id, opts?.cooldownMs);
    return true;
  }

  private isAvailable(s: SessionContext): boolean {
    if (s.paused || s.inUse) return false;
    if (s.cooldownUntil && s.cooldownUntil > Date.now()) return false;
    return true;
  }

  acquireNext(options?: AcquireSessionOptions): SessionContext | null {
    if (!this.pool.length) return null;
    const preferred = options?.preferredPlatform;
    const allowFallback = options?.allowPlatformFallback ?? true;

    const allowedSet = options?.allowedSessionIds?.length
      ? new Set(options.allowedSessionIds)
      : null;
    const excludedSet = options?.excludedSessionIds?.length
      ? new Set(options.excludedSessionIds)
      : null;

    const scan = (platform?: GatewayPlatform): SessionContext | null => {
      const total = this.pool.length;
      for (let i = 0; i < total; i++) {
        const idx = (this.cursor + i) % total;
        const candidate = this.pool[idx];
        if (allowedSet && !allowedSet.has(candidate.id)) continue;
        if (excludedSet && excludedSet.has(candidate.id)) continue;
        if (platform && candidate.platform !== platform) continue;
        if (!this.isAvailable(candidate)) continue;
        candidate.inUse = true;
        candidate.lastUsedAt = Date.now();
        this.cursor = (idx + 1) % total;
        return candidate;
      }
      return null;
    };

    if (preferred) {
      const pick = scan(preferred);
      if (pick) return pick;
      if (!allowFallback) return null;
    }
    return scan();
  }

  acquireNextScoped(allowedSessionIds: string[], options?: Omit<AcquireSessionOptions, "allowedSessionIds">) {
    return this.acquireNext({
      ...options,
      allowedSessionIds,
    });
  }

  snapshot() {
    return this.pool.map((p) => ({ ...p }));
  }
}
