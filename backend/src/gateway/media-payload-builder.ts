import crypto from "crypto";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { Readable } from "stream";
import { DeviceProfile } from "./contracts.js";
import { GatewayError } from "./errors.js";
import { GatewayErrorCode } from "./error-codes.js";

interface MediaPayloadInput {
  localAbsolutePath: string;
  profile: DeviceProfile;
  fieldName?: string;
  fileName?: string;
  extraFields?: Record<string, string>;
  includeHexPreview?: boolean;
  hexPreviewLimitBytes?: number;
}

interface MediaPayloadOutput {
  contentType: string;
  boundary: string;
  headers: Record<string, string>;
  bodyStream: NodeJS.ReadableStream;
  bodyHexPreview?: string;
  fileHexPreview?: string;
  bodyLength: number;
  mime: string;
  fileName: string;
  size: number;
}

const mimeFromPath = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mkv") return "video/x-matroska";
  return "application/octet-stream";
};

const createBoundary = (profile: DeviceProfile): string => {
  const nonce = crypto.randomBytes(12).toString("hex");
  if (profile.platform === "iOS") return `----WebKitFormBoundary${nonce}`;
  return `----OkHttpBoundary${nonce}`;
};

const boundaryCheck = (profile: DeviceProfile, boundary: string, mime: string, size: number): string => {
  const raw = `${profile.platform}|${boundary}|${mime}|${size}|${profile.model || ""}|${profile.osVersion || ""}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
};

const CRLF = "\r\n";

const bufferToHexPreview = (buf: Buffer, maxBytes: number): string => {
  const b = buf.byteLength > maxBytes ? buf.subarray(0, maxBytes) : buf;
  return b.toString("hex");
};

export const buildMultipartMediaPayload = async (input: MediaPayloadInput): Promise<MediaPayloadOutput> => {
  if (input.profile?.platform !== "iOS" && input.profile?.platform !== "Android") {
    throw new GatewayError({
      message: "profile.platform must be iOS or Android",
      code: GatewayErrorCode.INVALID_REQUEST,
      status: 400,
    });
  }

  if (!path.isAbsolute(input.localAbsolutePath)) {
    throw new GatewayError({
      message: "localAbsolutePath must be absolute",
      code: GatewayErrorCode.INVALID_REQUEST,
      status: 400,
    });
  }

  const stat = await fs.stat(input.localAbsolutePath);
  if (!stat.size) {
    throw new GatewayError({
      message: "media file is empty",
      code: GatewayErrorCode.INVALID_MESSAGE,
      status: 422,
    });
  }

  const mime = mimeFromPath(input.localAbsolutePath);
  const fieldName = input.fieldName || "file";
  const fileName = input.fileName || path.basename(input.localAbsolutePath);
  const boundary = createBoundary(input.profile);
  const boundaryChecksum = boundaryCheck(input.profile, boundary, mime, stat.size);

  const segments: Buffer[] = [];
  const pushTextField = (name: string, value: string) => {
    segments.push(Buffer.from(`--${boundary}${CRLF}`));
    segments.push(Buffer.from(`Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}`));
    segments.push(Buffer.from(`${value}${CRLF}`));
  };

  for (const [k, v] of Object.entries(input.extraFields || {})) {
    if (String(v).trim()) pushTextField(k, String(v));
  }

  segments.push(Buffer.from(`--${boundary}${CRLF}`));
  segments.push(
    Buffer.from(
      `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"${CRLF}` +
        `Content-Type: ${mime}${CRLF}${CRLF}`
    )
  );
  const filePrefix = Buffer.concat(segments);
  const fileSuffix = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  const bodyLength = filePrefix.byteLength + stat.size + fileSuffix.byteLength;
  const fileStream = fsSync.createReadStream(input.localAbsolutePath);
  const bodyStream = Readable.from((async function* () {
    yield filePrefix;
    for await (const chunk of fileStream) yield chunk as Buffer;
    yield fileSuffix;
  })());

  const includeHexPreview = !!input.includeHexPreview;
  const hexLimit = Math.max(64, Number(input.hexPreviewLimitBytes || 4096));
  let fileHexPreview: string | undefined;
  let bodyHexPreview: string | undefined;
  if (includeHexPreview) {
    const previewFile = await fs.readFile(input.localAbsolutePath);
    fileHexPreview = bufferToHexPreview(previewFile, hexLimit);
    bodyHexPreview = Buffer.concat([filePrefix, previewFile.subarray(0, Math.min(previewFile.byteLength, hexLimit)), fileSuffix]).toString("hex");
  }
  const contentType = `multipart/form-data; boundary=${boundary}`;

  const headers: Record<string, string> = {
    "content-type": contentType,
    "content-length": String(bodyLength),
  };

  if (input.profile.platform === "iOS") {
    headers["x-ios-boundary-check"] = boundaryChecksum;
  } else {
    headers["x-android-boundary-check"] = boundaryChecksum;
  }

  return {
    contentType,
    boundary,
    headers,
    bodyStream,
    bodyHexPreview,
    fileHexPreview,
    bodyLength,
    mime,
    fileName,
    size: stat.size,
  };
};
