import {
  buildHttpsRequest,
  buildMessagePayload,
  inferAlignmentRulesFromSamples,
  parseFiveFieldHexStream,
  parseSessionPacket,
} from "../services/sender/stateless-sender.js";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

(() => {
  const session = parseSessionPacket(
    "Cookie=px_cookie_x;sessionId=sid-1;clientId=client-9;X-PX-OS=iOS;User-Agent=UA-1;X-PX-UUID=u1;X-PX-VID=v2"
  );
  assert(session.cookie === "px_cookie_x", "session cookie parse failed");
  assert(session.os === "iOS", "session platform parse failed");

  const parsed = parseFiveFieldHexStream("aa11|bb22|cc33|dd44|ee55");
  assert(parsed.fieldBytesLength.length === 5, "five-field parsing failed");
  assert(parsed.totalBytes === 10, "total bytes mismatch");

  const built = buildHttpsRequest({
    endpoint: "https://example.com/api/send",
    session,
    fiveFieldHex: "aa11|bb22|cc33|dd44|ee55",
    message: { to: "+1 (555) 010-0001", text: "hello ios sms", type: "sms" },
  });
  assert(built.headers["user-agent"] === "UA-1", "ua header fill failed");
  assert(built.headers.cookie === "px_cookie_x", "cookie header fill failed");
  assert(!!built.body, "request body should not be empty");
  const iosBody = JSON.parse(built.body || "{}");
  assert(iosBody.message?.channel === "sms", "ios sms payload failed");

  const rules = inferAlignmentRulesFromSamples([
    "aa11|bb22|cc33|dd44|ee55",
    "aa11|bb22|cc33|dd44|ee55",
  ]);
  assert(rules.fields.length === 5, "alignment fields count mismatch");

  const androidSession = parseSessionPacket({
    token: "abc123",
    "X-PX-OS": "Android",
    "X-PX-OS-VERSION": "14",
    "X-PX-DEVICE-MODEL": "Pixel 8 Pro",
  });
  const androidImageReq = buildHttpsRequest({
    endpoint: "https://example.com/api/send",
    session: androidSession,
    message: {
      to: "15550100002",
      text: "hello android image",
      type: "image",
      imageBase64: "ZmFrZS1pbWFnZS1kYXRh",
    },
  });
  assert(
    androidImageReq.headers["x-px-os"] === "Android",
    "android header strategy failed"
  );
  const androidBody = JSON.parse(androidImageReq.body || "{}");
  assert(androidBody.message?.channel === "mms", "android image payload failed");
  assert(androidBody.message?.attachments?.length === 1, "android image attachment failed");

  const mmsByUrl = buildMessagePayload({
    platform: "iOS",
    message: { to: "15550100003", mediaUrl: "https://example.com/a.png" },
  });
  assert(mmsByUrl.channel === "mms", "image by url payload failed");

  console.log("stateless-sender test passed");
})();
