import { ProxyOrchestrator } from "../gateway/proxy-orchestrator.js";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

(() => {
  const orchestrator = new ProxyOrchestrator();
  orchestrator.upsertProxyNodes([
    { protocol: "http", host: "1.1.1.1", port: 1001, region: "NY", groupId: "g1" },
    { protocol: "http", host: "2.2.2.2", port: 1002, region: "CA", groupId: "g2" },
  ]);
  orchestrator.setSubAccountProxyGroups("sub-1", ["g1"]);

  const pick = orchestrator.acquireProxy({ sessionContextId: "s1", subAccountId: "sub-1", geoHint: "ny" });
  assert(!!pick, "proxy pick failed");
  assert(pick!.groupId === "g1", "sub-account group isolation failed");

  orchestrator.recordSendResult(pick!.id, { ok: false, status: 403 });
  orchestrator.recordSendResult(pick!.id, { ok: false, status: 403 });
  orchestrator.recordSendResult(pick!.id, { ok: false, status: 403 });
  const stats = orchestrator.getStats();
  const p = stats.list.find((x) => x.id === pick!.id);
  assert(p?.status === "Suspended", "suspend after rejected x3 failed");

  console.log("proxy-orchestrator smoke test passed");
})();

