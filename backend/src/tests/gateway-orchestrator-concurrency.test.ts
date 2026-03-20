import fs from "fs";
import os from "os";
import path from "path";
import { GatewayJob, GatewaySendResult } from "../gateway/contracts.js";
import { buildMultipartMediaPayload } from "../gateway/media-payload-builder.js";
import { GatewayOrchestrator } from "../gateway/orchestrator.js";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const orchestrator = new GatewayOrchestrator();
  const tmpFile = path.join(os.tmpdir(), `gw-load-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex"));

  // High-load media payload build to validate memory stability under concurrency.
  const beforeHeap = process.memoryUsage().heapUsed;
  await Promise.all(
    Array.from({ length: 60 }).map((_, i) =>
      buildMultipartMediaPayload({
        localAbsolutePath: tmpFile,
        profile: {
          platform: i % 2 === 0 ? "iOS" : "Android",
          model: i % 2 === 0 ? "iPhone14,8" : "Pixel 8 Pro",
          osVersion: i % 2 === 0 ? "18.4.1" : "14",
        },
        extraFields: { idx: String(i), mode: "load-test" },
      })
    )
  );
  const afterHeap = process.memoryUsage().heapUsed;
  const heapDeltaMb = (afterHeap - beforeHeap) / 1024 / 1024;
  assert(heapDeltaMb < 120, `heap delta too high: ${heapDeltaMb.toFixed(2)}MB`);

  const jobs: GatewayJob[] = Array.from({ length: 40 }).map((_, i) => {
    const platform = i % 2 === 0 ? "iOS" : "Android";
    return {
      jobId: `job-${i + 1}`,
      sessionContextId: `ctx-${(i % 8) + 1}`,
      input: {
        request: {
          tenantId: "tenant-regression",
          platform,
          session: {
            Cookie: "_pxhd=abc",
            "X-PX-AUTHORIZATION": "3:test",
            clientId: `client-${i + 1}`,
          },
          message:
            i % 3 === 0
              ? { to: `+1555010${String(i).padStart(4, "0")}`, type: "image", text: "img", mediaUrl: "https://example.com/x.png" }
              : { to: `+1555010${String(i).padStart(4, "0")}`, type: "sms", text: `sms-${i}` },
          hints: {
            endpoint: "https://example.com/upstream/send",
            method: "POST",
            timeoutMs: 5000,
          },
        },
        profile: {
          platform,
          sessionPx: platform === "iOS" ? "session-px-token" : undefined,
          model: platform === "iOS" ? "iPhone14,8" : "Pixel 8 Pro",
          osVersion: platform === "iOS" ? "18.4.1" : "14",
        },
        localAbsolutePath: i % 3 === 0 ? tmpFile : undefined,
      },
    };
  });

  let active = 0;
  let peak = 0;
  const mockExecutor = async (job: GatewayJob): Promise<GatewaySendResult> => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(10 + Math.floor(Math.random() * 20));
    active -= 1;
    return {
      requestId: `${job.jobId}-rid`,
      idempotencyKey: `${job.jobId}-ik`,
      traceId: `${job.jobId}-trace`,
      ok: true,
      retryable: false,
      status: 200,
      gatewayCode: "GW_200_OK",
      latencyMs: 15,
      responseHeaders: {},
      responseBody: '{"ok":true}',
    };
  };

  const results = await orchestrator.dispatchBatch(jobs, {
    maxConcurrency: 10,
    platformConcurrency: { iOS: 6, Android: 4 },
    profileMinIntervalMs: 2,
    failFast: false,
    executor: mockExecutor,
  });

  assert(results.length === jobs.length, "batch result size mismatch");
  assert(results.every((r) => r.ok), "not all jobs succeeded");
  assert(peak <= 10, `max concurrency exceeded: ${peak}`);

  fs.unlinkSync(tmpFile);
  console.log("gateway-orchestrator-concurrency test passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

