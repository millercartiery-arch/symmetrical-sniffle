import crypto from 'crypto';

const rawKey = process.env.MSG_ENC_KEY || '12345678901234567890123456789012';
const keyBytes =
  rawKey.length === 32
    ? Buffer.from(rawKey)
    : crypto.createHash('sha256').update(rawKey).digest();

/** 代理密码加密用 key（PROXY_ENC_KEY 为 32 字节 base64，否则回退 MSG_ENC_KEY） */
const proxyKeyBytes = ((): Buffer => {
  const b64 = process.env.PROXY_ENC_KEY?.trim();
  if (b64) {
    try {
      const buf = Buffer.from(b64, 'base64');
      if (buf.length >= 32) return buf.subarray(0, 32);
    } catch {}
  }
  return keyBytes;
})();

export function encrypt(text: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decrypt(buffer: Buffer): string {
  if (buffer.length < 28) throw new Error('Invalid buffer length');
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const enc = buffer.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** 代理密码加密后存库（base64 字符串，不包含明文） */
export function encryptProxyPassword(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', proxyKeyBytes, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** 从库中密文解密代理密码 */
export function decryptProxyPassword(cipherBase64: string | null | undefined): string {
  if (!cipherBase64 || typeof cipherBase64 !== 'string') return '';
  try {
    const buf = Buffer.from(cipherBase64, 'base64');
    if (buf.length < 28) return '';
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', proxyKeyBytes, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
