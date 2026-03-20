export type GatewayPlatform = "iOS" | "Android";
export type GatewayMessageType = "sms" | "image" | "audio" | "video";
export type GatewayImageEncoding = "url" | "base64" | "binary";

export interface GatewaySessionEnvelope {
  token?: string;
  cookie?: string;
  pxToken?: string;
  clientId?: string;
  sessionId?: string;
  signature?: string;
  uuid?: string;
  vid?: string;
  fp?: string;
  idfa?: string;
  gaid?: string;
  appVersion?: string;
  model?: string;
  osVersion?: string;
  language?: string;
  userAgent?: string;
  os?: GatewayPlatform;
  [key: string]: unknown;
}

export interface GatewayMessage {
  to: string;
  type: GatewayMessageType;
  text?: string;
  mediaUrl?: string;
  imageBase64?: string;
  imageBinaryHex?: string;
}

export interface GatewayProtocolHints {
  endpoint: string;
  method?: "POST" | "PUT" | "PATCH";
  protocolVersion?: string;
  adapterVersion?: string;
  fiveFieldHex?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface GatewaySendRequest {
  tenantId: string;
  requestId?: string;
  idempotencyKey?: string;
  platform: GatewayPlatform;
  session: GatewaySessionEnvelope;
  message: GatewayMessage;
  hints: GatewayProtocolHints;
  extraHeaders?: Record<string, string>;
}

export interface GatewayPacket {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Buffer | NodeJS.ReadableStream;
  metadata: {
    platform: GatewayPlatform;
    messageType: GatewayMessageType;
    protocolVersion: string;
    adapterVersion: string;
    idempotencyKey: string;
    requestId: string;
  };
}

export interface GatewaySendResult {
  requestId: string;
  idempotencyKey: string;
  traceId: string;
  ok: boolean;
  retryable: boolean;
  status: number;
  gatewayCode: string;
  upstreamCode?: string;
  latencyMs: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
}

export interface DeviceProfile {
  platform: GatewayPlatform;
  model?: string;
  osVersion?: string;
  appVersion?: string;
  userAgent?: string;
  sessionPx?: string;
  hardwareFingerprint?: string;
}

export interface GatewayDispatchInput {
  request: GatewaySendRequest;
  profile: DeviceProfile;
  localAbsolutePath?: string;
}

export interface GatewayJob {
  jobId?: string;
  sessionContextId?: string;
  input: GatewayDispatchInput;
}

export interface GatewayOrchestratorOptions {
  maxConcurrency?: number;
  platformConcurrency?: Partial<Record<GatewayPlatform, number>>;
  profileConcurrency?: Record<string, number>;
  profileMinIntervalMs?: number;
  failFast?: boolean;
  executor?: (job: GatewayJob) => Promise<GatewaySendResult>;
}

export interface GatewayJobResult {
  jobId: string;
  sessionContextId?: string;
  ok: boolean;
  result?: GatewaySendResult;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
