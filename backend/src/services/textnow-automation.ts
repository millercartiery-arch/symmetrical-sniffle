import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Page } from 'puppeteer';
import axios from 'axios';
import winston from 'winston';
import CaptchaSolver, { createCaptchaSolver } from './captcha-solver.js';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'textnow-automation.log' }),
  ],
});

/**
 * TextNow 自动化服务
 * 负责：登录、发送消息、验证码识别
 */
export class TextNowAutomation {
  private page: Page;
  private captchaSolver: CaptchaSolver | null;
  private maxRetries = 3;
  private remoteBaseUrl = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://hkd.llc').replace(/\/+$/, '');

  private readonly composeButtonSelectors = [
    '[data-testid="navbar-compose"]',
    'button[aria-label*="compose" i]',
    'button[aria-label*="new message" i]',
  ];

  private readonly usernameSelectors = [
    'input[name="username"]',
    'input[type="email"]',
    'input[placeholder*="username" i]',
    'input[placeholder*="email" i]',
  ];

  private readonly passwordSelectors = [
    'input[type="password"]',
  ];

  private readonly submitButtonSelectors = [
    'button[type="submit"]',
    'button[data-testid*="login" i]',
  ];

  private readonly phoneInputSelectors = [
    'input[placeholder*="phone" i]',
    'input[placeholder*="number" i]',
    'input[type="tel"]',
    'input[data-testid*="recipient" i]',
  ];

  private readonly conversationEntrySelectors = [
    '[role="option"]',
    '[data-testid*="contact" i]',
    '[class*="contact" i]',
    '[class*="recipient" i]',
  ];

  private readonly messageInputSelectors = [
    'textarea',
    '[contenteditable="true"]',
    'input[placeholder*="message" i]',
  ];

  private readonly sendButtonSelectors = [
    'button[aria-label*="send" i]',
    'button[data-testid*="send" i]',
    '[data-testid*="send" i]',
  ];

  private readonly attachButtonSelectors = [
    'button[aria-label*="attach" i]',
    'button[aria-label*="photo" i]',
    'button[aria-label*="image" i]',
    '[data-testid*="attach" i]',
    '[data-testid*="image" i]',
  ];

  private readonly fileInputSelectors = [
    'input[type="file"]',
    'input[accept*="image"]',
  ];

  private async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  private async findFirst(selectors: string[]) {
    for (const selector of selectors) {
      try {
        const handle = await this.page.$(selector);
        if (handle) return handle;
      } catch {
        // Ignore invalid selectors and keep trying alternatives.
      }
    }
    return null;
  }

  private async waitForAny(selectors: string[], timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const handle = await this.findFirst(selectors);
      if (handle) return handle;
      await this.sleep(250);
    }
    return null;
  }

  private async clickAny(selectors: string[], timeout = 5000) {
    const handle = await this.waitForAny(selectors, timeout);
    if (!handle) return false;
    await handle.click();
    return true;
  }

  private async clearAndType(handle: any, value: string, delay = 40) {
    await handle.click({ clickCount: 3 });
    await this.page.keyboard.press('Backspace');
    if (value) {
      await handle.type(value, { delay });
    }
  }

  private async isLoggedIn() {
    return Boolean(await this.findFirst(this.composeButtonSelectors));
  }

  private inferFileExtension(source: string, contentType = '') {
    const lowerType = contentType.toLowerCase();
    if (lowerType.includes('png')) return '.png';
    if (lowerType.includes('webp')) return '.webp';
    if (lowerType.includes('gif')) return '.gif';
    if (lowerType.includes('jpeg') || lowerType.includes('jpg')) return '.jpg';

    try {
      const url = new URL(source);
      const ext = path.extname(url.pathname);
      if (ext) return ext;
    } catch {
      // Ignore URL parse failures.
    }
    return '.jpg';
  }

  private normalizeMediaSource(source: string) {
    const trimmed = String(source || '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('data:')) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('/')) return `${this.remoteBaseUrl}${trimmed}`;
    return trimmed;
  }

  private parseCookieHeader(rawCookie: string) {
    return String(rawCookie || '')
      .split(';')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const index = segment.indexOf('=');
        if (index <= 0) return null;
        return {
          name: segment.slice(0, index).trim(),
          value: segment.slice(index + 1).trim(),
        };
      })
      .filter((item): item is { name: string; value: string } => Boolean(item?.name));
  }

  private async bootstrapSession(sessionCookie: string, sessionId?: string) {
    const cookies = this.parseCookieHeader(sessionCookie);
    if (sessionId && !cookies.some((item) => item.name.toLowerCase() === 'x-tn-session-id')) {
      cookies.push({ name: 'x-tn-session-id', value: sessionId });
    }
    if (!cookies.length) {
      return false;
    }

    await this.page.setCookie(
      ...cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: '.textnow.com',
        path: '/',
        secure: true,
        httpOnly: false,
      }))
    );
    await this.page.goto('https://www.textnow.com/messaging', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    }).catch(() => undefined);
    await this.sleep(2500);
    const ok = await this.isLoggedIn();
    if (ok) {
      logger.info('✅ Session cookie bootstrap succeeded');
    }
    return ok;
  }

  private async materializeImageFile(source: string) {
    const normalizedSource = this.normalizeMediaSource(source);
    if (!normalizedSource) {
      throw new Error('Missing image source');
    }

    if (!/^data:|^https?:\/\//i.test(normalizedSource)) {
      return { filePath: normalizedSource, cleanup: false };
    }

    let buffer: Buffer;
    let ext = '.jpg';

    if (normalizedSource.startsWith('data:')) {
      const match = normalizedSource.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        throw new Error('Unsupported data URL image payload');
      }
      const mime = match[1].toLowerCase();
      buffer = Buffer.from(match[2], 'base64');
      ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : mime.includes('gif') ? '.gif' : '.jpg';
    } else {
      const response = await axios.get<ArrayBuffer>(normalizedSource, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      buffer = Buffer.from(response.data);
      ext = this.inferFileExtension(normalizedSource, String(response.headers['content-type'] || ''));
    }

    const tempFilePath = path.join(os.tmpdir(), `tn-image-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    await fs.writeFile(tempFilePath, buffer);
    return { filePath: tempFilePath, cleanup: true };
  }

  private async openComposer(targetPhone: string) {
    await this.page.goto('https://www.textnow.com/messaging', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    await this.sleep(1500);
    await this.clickAny(this.composeButtonSelectors, 8000).catch(() => false);
    await this.sleep(1000);

    const phoneInput = await this.waitForAny(this.phoneInputSelectors, 10000);
    if (!phoneInput) {
      throw new Error('Phone input not found');
    }

    await this.clearAndType(phoneInput, targetPhone, 30);
    logger.info(`✅ Target phone entered: ${targetPhone}`);

    await this.sleep(1200);
    const firstContact = await this.findFirst(this.conversationEntrySelectors);
    if (firstContact) {
      await firstContact.click();
      await this.sleep(1200);
      logger.info('✅ Contact selected');
    } else {
      await this.page.keyboard.press('Enter').catch(() => undefined);
      await this.sleep(1200);
    }
  }

  private async uploadImage(mediaUrl: string) {
    const { filePath, cleanup } = await this.materializeImageFile(mediaUrl);

    try {
      let fileInput = await this.findFirst(this.fileInputSelectors);
      if (!fileInput) {
        const attachButton = await this.findFirst(this.attachButtonSelectors);
        if (attachButton) {
          const chooserPromise = this.page.waitForFileChooser({ timeout: 5000 }).catch(() => null);
          await attachButton.click();
          const chooser = await chooserPromise;
          if (chooser) {
            await chooser.accept([filePath]);
            await this.sleep(2500);
            logger.info('✅ Image uploaded via file chooser');
            return;
          }
        }
        fileInput = await this.waitForAny(this.fileInputSelectors, 5000);
      }

      if (!fileInput) {
        throw new Error('Image file input not found');
      }

      await (fileInput as any).uploadFile(filePath);
      await this.sleep(2500);
      logger.info('✅ Image uploaded via file input');
    } finally {
      if (cleanup) {
        await fs.unlink(filePath).catch(() => undefined);
      }
    }
  }

  constructor(page: Page) {
    this.page = page;
    this.captchaSolver = createCaptchaSolver();
  }

  /**
   * 解决验证码（集成多种验证码服务）
   */
  async solveCaptcha(imageBase64: string): Promise<string> {
    if (!this.captchaSolver) {
      logger.warn('⚠️ Captcha solver not configured, skipping captcha solving');
      return '';
    }

    try {
      logger.info('🔐 Solving image captcha...');
      const result = await this.captchaSolver.solveImageCaptcha(imageBase64);

      if (!result.success) {
        logger.error(`❌ Failed to solve captcha: ${result.error}`);
        return '';
      }

      return result.text || '';
    } catch (error: any) {
      logger.error(`❌ Captcha solving error: ${error.message}`);
      return '';
    }
  }

  /**
   * 登录 TextNow
   */
  async login(username: string, password: string): Promise<boolean> {
    try {
      logger.info(`🔑 Starting TextNow login for: ${username}`);

      await this.page.goto('https://www.textnow.com/login', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      if (await this.isLoggedIn()) {
        logger.info('✅ Already logged in (session found)');
        return true;
      }

      const usernameInput = await this.waitForAny(this.usernameSelectors, 10000);
      if (!usernameInput) {
        logger.error('❌ Username input field not found');
        return false;
      }

      await this.clearAndType(usernameInput, username, 50);
      logger.info('✅ Username entered');

      const passwordInput = await this.waitForAny(this.passwordSelectors, 10000);
      if (!passwordInput) {
        logger.error('❌ Password input field not found');
        return false;
      }

      await this.clearAndType(passwordInput, password, 50);
      logger.info('✅ Password entered');

      const loginButton = await this.waitForAny(this.submitButtonSelectors, 10000);
      if (!loginButton) {
        logger.error('❌ Login button not found');
        return false;
      }

      await loginButton.click();
      logger.info('✅ Login button clicked');
      await this.sleep(2000);

      const captchaPresent = await this.page.evaluate(() => {
        return !!(
          document.querySelector('iframe[src*="recaptcha"]') ||
          document.querySelector('iframe[src*="captcha"]') ||
          document.querySelector('[data-testid*="captcha" i]') ||
          document.querySelector('[class*="captcha" i]')
        );
      });

      if (captchaPresent) {
        logger.info('🤖 Captcha detected, attempting to solve...');
        const captchaSolved = await this.solveRecaptcha();
        if (!captchaSolved) {
          logger.warn('⚠️ Failed to solve captcha, retrying...');
          return false;
        }

        logger.info('✅ Captcha solved');
      }

      await this.page.goto('https://www.textnow.com/messaging', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      }).catch(() => undefined);
      await this.sleep(2500);
      const loginSuccess = await this.isLoggedIn();
      if (loginSuccess) {
        logger.info('✅ Login successful!');
        return true;
      }
      logger.error('❌ Login failed - messaging interface not found');
      return false;
    } catch (error: any) {
      logger.error(`❌ Login error: ${error.message}`);
      return false;
    }
  }

  /**
   * 解铃 reCAPTCHA v2/v3
   */
  async solveRecaptcha(): Promise<boolean> {
    try {
      const frames = await this.page.frames();
      for (const frame of frames) {
        const frameUrl = frame.url();
        if (frameUrl.includes('recaptcha') || frameUrl.includes('captcha')) {
          logger.info(`📍 Found captcha iframe: ${frameUrl}`);

          // 方式 1: 尝试单击 reCAPTCHA 复选框
          try {
            const checkbox = await frame.$('[id="recaptcha-anchor"]');
            if (checkbox) {
              await checkbox.click();
              logger.info('✅ Clicked reCAPTCHA checkbox');
              await this.sleep(3000);
              return true;
            }
          } catch (e) {
            logger.debug('reCAPTCHA checkbox not found');
          }

          // 方式 2: 尝试从 reCAPTCHA 文本获取 token
          try {
            const tokenMatch = await this.page.evaluate(() => {
              const script = Array.from(document.querySelectorAll('script')).find(s =>
                s.textContent?.includes('recaptcha_callback')
              );
              return script?.textContent?.match(/recaptcha_callback\(.*?\)/)?.[0];
            });

            if (tokenMatch) {
              logger.info(`✅ reCAPTCHA token found: ${tokenMatch.substring(0, 50)}...`);
              return true;
            }
          } catch (e) {
            logger.debug('Could not extract reCAPTCHA token');
          }
        }
      }

      return false;
    } catch (error: any) {
      logger.error(`❌ reCAPTCHA solving error: ${error.message}`);
      return false;
    }
  }

  /**
   * 发送消息到目标号码
   */
  async sendMessage(targetPhone: string, message: string, mediaUrl?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!message.trim() && !String(mediaUrl || '').trim()) {
        return { success: false, error: 'Message payload is empty' };
      }

      logger.info(`📱 Sending message to ${targetPhone}`);
      await this.openComposer(targetPhone);

      if (String(mediaUrl || '').trim()) {
        await this.uploadImage(String(mediaUrl));
      }

      const messageInput = await this.waitForAny(this.messageInputSelectors, 10000);
      if (!messageInput && message.trim()) {
        logger.error('❌ Message input field not found');
        return { success: false, error: 'Message input not found' };
      }

      if (messageInput && message.trim()) {
        await messageInput.click();
        await messageInput.type(message, { delay: 20 });
        logger.info('✅ Message typed');
      }

      const sendButton = await this.waitForAny(this.sendButtonSelectors, 10000);
      if (!sendButton) {
        logger.error('❌ Send button not found');
        return { success: false, error: 'Send button not found' };
      }

      await sendButton.click();
      await this.sleep(3000);

      logger.info('✅ Message sent successfully!');
      return { success: true, messageId: `${targetPhone}-${Date.now()}` };
    } catch (error: any) {
      logger.error(`❌ Send message error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 执行完整的发送流程
   */
  async executeFullFlow(input: {
    username: string;
    password: string;
    targetPhone: string;
    message?: string;
    mediaUrl?: string;
    messageType?: 'text' | 'image';
    sessionCookie?: string;
    sessionId?: string;
  }): Promise<{
    success: boolean;
    steps: {
      login: boolean;
      sendMessage: boolean;
    };
    error?: string;
  }> {
    try {
      logger.info(`🚀 Starting full TextNow automation flow...`);

      let loginSuccess = false;
      if (String(input.sessionCookie || '').trim()) {
        loginSuccess = await this.bootstrapSession(String(input.sessionCookie || ''), String(input.sessionId || ''));
      }
      if (!loginSuccess) {
        loginSuccess = await this.login(input.username, input.password);
      }
      if (!loginSuccess) {
        logger.error('❌ Login failed, aborting send operation');
        return {
          success: false,
          steps: { login: false, sendMessage: false },
          error: 'Login failed',
        };
      }

      const messageText = String(input.message || '').trim();
      const imageSource = String(input.mediaUrl || '').trim();
      const sendResult = await this.sendMessage(input.targetPhone, messageText, input.messageType === 'image' ? imageSource : '');
      if (!sendResult.success) {
        logger.error('❌ Send message failed');
        return {
          success: false,
          steps: { login: true, sendMessage: false },
          error: sendResult.error,
        };
      }

      logger.info('✅ Full flow completed successfully!');
      return {
        success: true,
        steps: { login: true, sendMessage: true },
      };
    } catch (error: any) {
      logger.error(`❌ Full flow error: ${error.message}`);
      return {
        success: false,
        steps: { login: false, sendMessage: false },
        error: error.message,
      };
    }
  }
}

export default TextNowAutomation;
