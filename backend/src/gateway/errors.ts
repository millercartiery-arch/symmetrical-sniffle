import { GatewayErrorCode, GatewayErrorCodeValue } from "./error-codes.js";

export class GatewayError extends Error {
  code: GatewayErrorCodeValue;
  status: number;
  retryable: boolean;
  details?: unknown;

  constructor(args: {
    message: string;
    code?: GatewayErrorCodeValue;
    status?: number;
    retryable?: boolean;
    details?: unknown;
  }) {
    super(args.message);
    this.name = "GatewayError";
    this.code = args.code || GatewayErrorCode.UNKNOWN_ERROR;
    this.status = args.status ?? 500;
    this.retryable = args.retryable ?? false;
    this.details = args.details;
  }
}

export const isGatewayError = (err: unknown): err is GatewayError => err instanceof GatewayError;

