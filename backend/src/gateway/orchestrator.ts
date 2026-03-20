import crypto from "crypto";
import {
  GatewayJob,
  GatewayJobResult,
  GatewayOrchestratorOptions,
} from "./contracts.js";
import { GatewayError, isGatewayError } from "./errors.js";
import { StatelessProtocolGatewayService } from "./service.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly limit: number) {}

  async acquire() {
    if (this.limit <= 0) return;
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  release() {
    if (this.limit <= 0) return;
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

const profileKeyOf = (job: GatewayJob): string =>
  `${job.input.profile.platform}:${job.input.profile.model || "unknown"}:${job.sessionContextId || "ctx"}`;

export class GatewayOrchestrator {
  private service = new StatelessProtocolGatewayService();

  async dispatchBatch(jobs: GatewayJob[], options?: GatewayOrchestratorOptions): Promise<GatewayJobResult[]> {
    const maxConcurrency = Math.max(1, options?.maxConcurrency || 8);
    const profileMinIntervalMs = Math.max(0, options?.profileMinIntervalMs || 0);
    const failFast = !!options?.failFast;

    const platformSem = new Map<string, Semaphore>();
    const profileSem = new Map<string, Semaphore>();
    const profileLastDispatch = new Map<string, number>();

    const getPlatformSem = (platform: "iOS" | "Android"): Semaphore => {
      if (!platformSem.has(platform)) {
        const limit = Math.max(1, options?.platformConcurrency?.[platform] || maxConcurrency);
        platformSem.set(platform, new Semaphore(limit));
      }
      return platformSem.get(platform)!;
    };

    const getProfileSem = (key: string): Semaphore => {
      if (!profileSem.has(key)) {
        const limit = Math.max(1, options?.profileConcurrency?.[key] || 1);
        profileSem.set(key, new Semaphore(limit));
      }
      return profileSem.get(key)!;
    };

    const results: GatewayJobResult[] = new Array(jobs.length);
    let cursor = 0;
    let stop = false;
    const executor =
      options?.executor ||
      (async (job: GatewayJob) => {
        return this.service.sendDispatched(job.input);
      });

    const worker = async () => {
      while (true) {
        if (stop) return;
        const index = cursor++;
        if (index >= jobs.length) return;
        const job = jobs[index];
        const jobId = job.jobId || crypto.randomUUID();
        const pKey = profileKeyOf(job);
        const platformLock = getPlatformSem(job.input.profile.platform);
        const profileLock = getProfileSem(pKey);

        await platformLock.acquire();
        await profileLock.acquire();
        try {
          if (profileMinIntervalMs > 0) {
            const last = profileLastDispatch.get(pKey) || 0;
            const elapsed = Date.now() - last;
            const waitMs = profileMinIntervalMs - elapsed;
            if (waitMs > 0) await sleep(waitMs);
          }
          profileLastDispatch.set(pKey, Date.now());

          const result = await executor(job);
          results[index] = {
            jobId,
            sessionContextId: job.sessionContextId,
            ok: result.ok,
            result,
          };
          if (!result.ok && failFast) stop = true;
        } catch (err: any) {
          const gatewayErr = isGatewayError(err)
            ? err
            : new GatewayError({
                message: err?.message || "dispatch failed",
                retryable: false,
              });
          results[index] = {
            jobId,
            sessionContextId: job.sessionContextId,
            ok: false,
            error: {
              code: gatewayErr.code,
              message: gatewayErr.message,
              retryable: gatewayErr.retryable,
            },
          };
          if (failFast) stop = true;
        } finally {
          profileLock.release();
          platformLock.release();
        }
      }
    };

    const workers = Array.from({ length: Math.min(maxConcurrency, jobs.length || 1) }, () => worker());
    await Promise.all(workers);
    return results;
  }
}
