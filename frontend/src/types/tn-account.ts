
export type AccountStatus = 'VALID' | 'INVALID' | 'PENDING' | 'DUPLICATED' | 'NETWORK_ERROR';

export interface BaseAccount {
  id?: string;
  username: string;
  password: string;
  email?: string;
  phone?: string;
  priority?: number;
  region?: string;
  created_at: string;
  updated_at?: string;
  isValid?: boolean;
  validationError?: string;
  checkedAt?: string;
  platform: 'ios' | 'android' | 'web';
  appVersion?: string;
  userAgent?: string;
  clientId?: string;
  osVersion?: string;
  model?: string;
  uuid?: string;
  vid?: string;
  language?: string;
  token?: string;
  signature?: string;
}

export interface IOSAccount extends BaseAccount {
  platform: 'ios';
  cookie?: string;
  x_px_authorization?: string;
  x_px_device_fp?: string;
  x_px_device_model?: string;
  x_px_os?: string;
  x_px_os_version?: string;
  x_px_uuid?: string;
  x_px_vid?: string;
  x_tn_integrity_session?: string;
  [key: string]: any;
}

export interface AndroidAccount extends BaseAccount {
  platform: 'android';
  brand?: string;
  sessionId?: string;
  fp?: string;
  time?: string;
  type?: string;
  [key: string]: any;
}

export interface WebAccount extends BaseAccount {
  platform: 'web';
  cookie?: string;
  [key: string]: any;
}

export type TNAccount = IOSAccount | AndroidAccount | WebAccount;

export interface ImportResult {
  total: number;
  valid: number;
  invalid: number;
  pending: number;
  duplicated: number;
  accounts: TNAccount[];
}
