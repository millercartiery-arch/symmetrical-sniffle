import { SessionRotator } from "../gateway/session-rotator.js";
import { TenantResourceManager } from "../gateway/tenant-resource-manager.js";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

(() => {
  const manager = new TenantResourceManager();
  const global = Array.from({ length: 50 }).map((_, i) => `tn-${i + 1}`);
  manager.setGlobalSessionPool(global);
  const created = manager.createSubAccounts(5, 10);
  assert(created.length === 5, "sub-account create count mismatch");

  const sub1 = manager.getAssignedSessionIds("sub-1");
  const sub2 = manager.getAssignedSessionIds("sub-2");
  assert(sub1[0] === "tn-1" && sub1.length === 10, "sub-1 distribution mismatch");
  assert(sub2[0] === "tn-11" && sub2.length === 10, "sub-2 distribution mismatch");
  assert(manager.validateApiKey("sub-1", manager.getSubAccount("sub-1")?.apiKey), "api key validation failed");

  const rotator = new SessionRotator();
  rotator.registerBatch(
    global.map((id, idx) => ({
      id,
      platform: idx % 2 === 0 ? "iOS" : "Android",
      profile: { platform: idx % 2 === 0 ? "iOS" : "Android" },
      session: { token: `t-${id}` },
      cooldownMs: 0,
    }))
  );

  const scopedPick = rotator.acquireNextScoped(sub2, { allowPlatformFallback: true });
  assert(!!scopedPick, "scoped acquire failed");
  assert(sub2.includes(scopedPick!.id), "scoped acquire escaped private pool");
  rotator.release(scopedPick!.id, { cooldownMs: 0 });

  console.log("subaccount-distribution smoke test passed");
})();

