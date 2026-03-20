export const GatewayErrorCode = {
  INVALID_REQUEST: "GW_400_INVALID_REQUEST",
  INVALID_SESSION: "GW_401_INVALID_SESSION",
  INVALID_MESSAGE: "GW_422_INVALID_MESSAGE",
  INVALID_PROTOCOL_HINTS: "GW_422_INVALID_PROTOCOL_HINTS",
  UNSUPPORTED_PLATFORM: "GW_422_UNSUPPORTED_PLATFORM",
  PACKET_BUILD_FAILED: "GW_500_PACKET_BUILD_FAILED",
  TRANSPORT_TIMEOUT: "GW_504_TRANSPORT_TIMEOUT",
  TRANSPORT_NETWORK_ERROR: "GW_503_TRANSPORT_NETWORK_ERROR",
  UPSTREAM_BAD_REQUEST: "GW_502_UPSTREAM_BAD_REQUEST",
  UPSTREAM_UNAUTHORIZED: "GW_502_UPSTREAM_UNAUTHORIZED",
  UPSTREAM_THROTTLED: "GW_502_UPSTREAM_THROTTLED",
  UPSTREAM_SERVER_ERROR: "GW_502_UPSTREAM_SERVER_ERROR",
  UNKNOWN_ERROR: "GW_500_UNKNOWN_ERROR",
} as const;

export type GatewayErrorCodeValue = (typeof GatewayErrorCode)[keyof typeof GatewayErrorCode];

export const classifyUpstreamByStatus = (status: number): GatewayErrorCodeValue => {
  if (status === 400 || status === 404) return GatewayErrorCode.UPSTREAM_BAD_REQUEST;
  if (status === 401 || status === 403) return GatewayErrorCode.UPSTREAM_UNAUTHORIZED;
  if (status === 429) return GatewayErrorCode.UPSTREAM_THROTTLED;
  if (status >= 500) return GatewayErrorCode.UPSTREAM_SERVER_ERROR;
  return GatewayErrorCode.UNKNOWN_ERROR;
};

export const isRetryableStatus = (status: number): boolean => {
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500 && status <= 599;
};

