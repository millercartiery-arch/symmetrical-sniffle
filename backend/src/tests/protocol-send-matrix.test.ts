import fs from "fs";
import path from "path";
import { buildHttpsRequest, parseSessionPacket } from "../services/sender/stateless-sender.js";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

(() => {
  const desktopPath = path.join(process.env.USERPROFILE || "", "Desktop", "测试号.txt");
  const exists = fs.existsSync(desktopPath);
  if (!exists) {
    console.log("protocol-send-matrix skipped: Desktop/测试号.txt not found");
    return;
  }

  const lines = fs
    .readFileSync(desktopPath, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  assert(lines.length >= 1, "no account lines in 测试号.txt");

  const first = JSON.parse(lines[0]) as Record<string, unknown>;
  const iosSession = parseSessionPacket(first);

  const iosSms = buildHttpsRequest({
    endpoint: "https://example.com/internal/send",
    session: iosSession,
    message: { to: "15550100011", text: "ios sms smoke", type: "sms" },
  });
  const iosImg = buildHttpsRequest({
    endpoint: "https://example.com/internal/send",
    session: iosSession,
    message: { to: "15550100012", text: "ios image smoke", type: "image", mediaUrl: "https://example.com/i.png" },
  });

  const androidSession = parseSessionPacket({
    ...first,
    "X-PX-OS": "Android",
    "X-PX-OS-VERSION": "14",
    "X-PX-DEVICE-MODEL": "Pixel 8 Pro",
    "User-Agent": "TextNow/26.8.0 (Pixel 8 Pro; Android 14; Scale/3.00)",
  });
  const androidSms = buildHttpsRequest({
    endpoint: "https://example.com/internal/send",
    session: androidSession,
    message: { to: "15550100021", text: "android sms smoke", type: "sms" },
  });
  const androidImg = buildHttpsRequest({
    endpoint: "https://example.com/internal/send",
    session: androidSession,
    message: {
      to: "15550100022",
      text: "android image smoke",
      type: "image",
      imageBase64: "ZmFrZQ==",
    },
  });

  const iosSmsBody = JSON.parse(iosSms.body || "{}");
  const iosImgBody = JSON.parse(iosImg.body || "{}");
  const androidSmsBody = JSON.parse(androidSms.body || "{}");
  const androidImgBody = JSON.parse(androidImg.body || "{}");

  assert(iosSms.headers["x-px-os"] === "iOS", "ios sms header x-px-os failed");
  assert(iosSmsBody.message?.channel === "sms", "ios sms channel failed");
  assert(iosImgBody.message?.channel === "mms", "ios image channel failed");

  assert(androidSms.headers["x-px-os"] === "Android", "android sms header x-px-os failed");
  assert(androidSmsBody.message?.channel === "sms", "android sms channel failed");
  assert(androidImgBody.message?.channel === "mms", "android image channel failed");

  console.log("protocol-send-matrix test passed");
})();
