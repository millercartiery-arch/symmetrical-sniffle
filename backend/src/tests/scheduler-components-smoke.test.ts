import { FlowController } from "../gateway/flow-controller.js";
import { MessageQueueManager } from "../gateway/message-queue-manager.js";
import { SessionRotator } from "../gateway/session-rotator.js";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // SessionRotator cooldown + round-robin
  const rotator = new SessionRotator();
  rotator.registerBatch([
    {
      id: "s1",
      platform: "iOS",
      profile: { platform: "iOS", model: "iPhone14,8" },
      session: { Cookie: "_pxhd=a" },
      cooldownMs: 50,
    },
    {
      id: "s2",
      platform: "Android",
      profile: { platform: "Android", model: "Pixel 8 Pro" },
      session: { token: "t2" },
      cooldownMs: 50,
    },
  ]);
  const a = rotator.acquireNext();
  assert(!!a, "rotator acquire failed");
  rotator.release(a!.id);
  const b = rotator.acquireNext({ preferredPlatform: a!.platform, allowPlatformFallback: false });
  assert(!b, "cooldown did not block immediate reuse");
  await sleep(60);
  const c = rotator.acquireNext({ preferredPlatform: a!.platform, allowPlatformFallback: false });
  assert(!!c, "cooldown did not recover");
  rotator.release(c!.id);

  // FlowController circuit breaker after 5 x 403
  let alerted = false;
  const flow = new FlowController({
    breakerThreshold: 5,
    breakerOpenMs: 500,
    onCircuitOpen: () => {
      alerted = true;
    },
  });
  for (let i = 0; i < 5; i++) {
    flow.recordResult("s1", {
      requestId: "r",
      idempotencyKey: "k",
      traceId: "t",
      ok: false,
      retryable: false,
      status: 403,
      gatewayCode: "GW_502_UPSTREAM_UNAUTHORIZED",
      latencyMs: 1,
      responseHeaders: {},
      responseBody: '{"error":"403"}',
    });
  }
  assert(alerted, "circuit open alert not fired");
  assert(flow.isCircuitOpen("s1"), "circuit should be open");
  await sleep(520);
  assert(!flow.isCircuitOpen("s1"), "circuit should auto-close after open window");

  // MessageQueueManager async consume
  const queue = new MessageQueueManager<number>({ concurrency: 3, defaultMaxAttempts: 2 });
  let sum = 0;
  await queue.start(async ({ task }) => {
    sum += task.payload;
    return { ok: true };
  });
  queue.enqueueBatch([1, 2, 3, 4, 5].map((n) => ({ payload: n })));
  await sleep(80);
  assert(sum === 15, `queue consume mismatch: ${sum}`);
  await queue.stop();

  console.log("scheduler-components-smoke test passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

