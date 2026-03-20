export interface CaptchaEntry {
  code: string;
  expiresAt: number;
}

export const captchaStore = new Map<string, CaptchaEntry>();
