import assert from "node:assert/strict";
import { getMissingRequiredFields, normalizeImportAccount } from "../shared/import-normalizer.js";

const sample = {
  Cookie: "cookie-value",
  clientId: "client-1",
  "User-Agent": "TextNow/26.6.0",
  "X-PX-DEVICE-MODEL": "iPhone18,2",
  "X-PX-OS": "iOS",
  "X-PX-VID": "vid-1",
  "X-PX-OS-VERSION": "26.2",
  "X-PX-UUID": "uuid-1",
  "X-TN-Integrity-Session": "integrity-session-signature",
  phone: "9093127177",
  "X-PX-DEVICE-FP": "fp-1",
  email: "demo@example.com",
  username: "demo-user",
  "X-PX-MOBILE-SDK-VERSION": "3.2.7",
  password: "demo-pass"
};

const normalized = normalizeImportAccount(sample);
assert.equal(normalized.phone, "9093127177");
assert.equal(normalized.token, "cookie-value");
assert.equal(normalized.clientId, "client-1");
assert.equal(normalized.signature, "integrity-session-signature");
assert.equal(normalized.sessionId, "");
assert.equal(normalized.platform, "iOS");
assert.equal(normalized.model, "iPhone18,2");
assert.equal(normalized.osVersion, "26.2");
assert.equal(normalized.uuid, "uuid-1");
assert.equal(normalized.vid, "vid-1");
assert.equal(normalized.fp, "fp-1");
assert.equal(normalized.userAgent, "TextNow/26.6.0");
assert.equal(normalized.appVersion, "3.2.7");
assert.deepEqual(getMissingRequiredFields(normalized), []);

const missing = normalizeImportAccount({
  username: "u1",
  phone: "18888888888"
});
assert.equal(missing.password, "123456");
const missingFields = getMissingRequiredFields(missing);
assert.ok(missingFields.includes("token"));
assert.ok(missingFields.includes("clientId"));
assert.ok(missingFields.includes("signature"));

console.log("import-normalizer tests passed");
