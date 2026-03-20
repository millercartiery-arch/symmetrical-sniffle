import axios from 'axios';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'captcha-solver.log' }),
  ],
});

export type CaptchaSolverType = '2captcha' | 'anticaptcha' | 'deathbycaptcha';

export interface CaptchaSolverConfig {
  type: CaptchaSolverType;
  apiKey: string;
}

/**
 * 通用验证码识别服务
 * 支持多种服务商：2Captcha、Anti-Captcha、DeathByCaptcha
 */
export class CaptchaSolver {
  private type: CaptchaSolverType;
  private apiKey: string;

  constructor(config: CaptchaSolverConfig) {
    this.type = config.type;
    this.apiKey = config.apiKey;
    logger.info(`✅ Captcha Solver initialized: ${config.type}`);
  }

  /**
   * 识别 reCAPTCHA v2
   */
  async solveRecaptchaV2(siteKey: string, pageUrl: string): Promise<{ success: boolean; token?: string; error?: string }> {
    logger.info(`🔐 Solving reCAPTCHA v2 for ${pageUrl}`);

    try {
      switch (this.type) {
        case '2captcha':
          return await this.solveRecaptchaV2_2Captcha(siteKey, pageUrl);
        case 'anticaptcha':
          return await this.solveRecaptchaV2_AntiCaptcha(siteKey, pageUrl);
        case 'deathbycaptcha':
          return await this.solveRecaptchaV2_DeathByCaptcha(siteKey, pageUrl);
        default:
          return { success: false, error: `Unknown solver type: ${this.type}` };
      }
    } catch (error: any) {
      logger.error(`❌ reCAPTCHA v2 solving error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 2Captcha - reCAPTCHA v2
   */
  private async solveRecaptchaV2_2Captcha(siteKey: string, pageUrl: string): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      logger.info(`📝 Uploading to 2Captcha...`);

      // 上传任务
      const uploadRes = await axios.post('http://2captcha.com/api/captcha', {
        apikey: this.apiKey,
        method: 'userrecaptcha',
        googlekey: siteKey,
        pageurl: pageUrl,
        json: 1,
      });

      if (uploadRes.data.status !== 0) {
        return { success: false, error: uploadRes.data.error };
      }

      const captchaId = uploadRes.data.captcha;
      logger.info(`📊 Captcha ID: ${captchaId}`);

      // 轮询获取结果
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 1000)); // 1 秒轮询

        const resultRes = await axios.get('http://2captcha.com/api/res', {
          params: {
            apikey: this.apiKey,
            captcha_id: captchaId,
            json: 1,
          },
        });

        if (resultRes.data.status === 0) continue; // 未完成
        if (resultRes.data.status === 1) {
          logger.info(`✅ 2Captcha recaptcha solved!`);
          return { success: true, token: resultRes.data.request };
        }

        return { success: false, error: resultRes.data.error };
      }

      return { success: false, error: 'Timeout after 120 seconds' };
    } catch (error: any) {
      logger.error(`❌ 2Captcha error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Anti-Captcha - reCAPTCHA v2
   */
  private async solveRecaptchaV2_AntiCaptcha(siteKey: string, pageUrl: string): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      logger.info(`📝 Uploading to Anti-Captcha...`);

      // 创建任务
      const createRes = await axios.post('https://api.anti-captcha.com/createTask', {
        clientKey: this.apiKey,
        task: {
          type: 'NoCaptchaTaskProxyless',
          websiteURL: pageUrl,
          websiteKey: siteKey,
        },
        softId: 0,
        languagePool: 'en',
      });

      if (!createRes.data.taskId) {
        return { success: false, error: createRes.data.errorDescription };
      }

      const taskId = createRes.data.taskId;
      logger.info(`📊 Task ID: ${taskId}`);

      // 轮询获取结果
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 1000)); // 1 秒轮询

        const resultRes = await axios.post('https://api.anti-captcha.com/getTaskResult', {
          clientKey: this.apiKey,
          taskId: taskId,
        });

        if (resultRes.data.isDone === false) continue; // 未完成
        if (resultRes.data.solution) {
          logger.info(`✅ Anti-Captcha recaptcha solved!`);
          return { success: true, token: resultRes.data.solution.gRecaptchaResponse };
        }

        return { success: false, error: resultRes.data.errorDescription };
      }

      return { success: false, error: 'Timeout after 120 seconds' };
    } catch (error: any) {
      logger.error(`❌ Anti-Captcha error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * DeathByCaptcha - reCAPTCHA v2
   */
  private async solveRecaptchaV2_DeathByCaptcha(siteKey: string, pageUrl: string): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      logger.info(`📝 Uploading to DeathByCaptcha...`);

      // 创建验证码
      const createRes = await axios.post(`http://deathbycaptcha.com/api/captcha`, {
        username: process.env.DBC_USERNAME || '',
        password: process.env.DBC_PASSWORD || '',
        captchafile: `${siteKey}|${pageUrl}`,
        type: 4, // recaptcha v2
      });

      if (!createRes.data.captcha) {
        return { success: false, error: createRes.data.error };
      }

      const captchaId = createRes.data.captcha;
      logger.info(`📊 Captcha ID: ${captchaId}`);

      // 轮询获取结果
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 1000)); // 1 秒轮询

        const resultRes = await axios.get(`http://deathbycaptcha.com/api/captcha/${captchaId}`, {
          auth: {
            username: process.env.DBC_USERNAME || '',
            password: process.env.DBC_PASSWORD || '',
          },
        });

        if (resultRes.data.is_correct === false) {
          if (resultRes.data.text) {
            logger.info(`✅ DeathByCaptcha recaptcha solved!`);
            return { success: true, token: resultRes.data.text };
          }
          continue; // 仍在处理中
        }

        return { success: false, error: 'Captcha not recognized' };
      }

      return { success: false, error: 'Timeout after 120 seconds' };
    } catch (error: any) {
      logger.error(`❌ DeathByCaptcha error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 识别图像验证码
   */
  async solveImageCaptcha(imageBase64: string): Promise<{ success: boolean; text?: string; error?: string }> {
    logger.info(`🖼️ Solving image captcha...`);

    try {
      switch (this.type) {
        case '2captcha':
          return await this.solveImageCaptcha_2Captcha(imageBase64);
        case 'anticaptcha':
          return await this.solveImageCaptcha_AntiCaptcha(imageBase64);
        case 'deathbycaptcha':
          return await this.solveImageCaptcha_DeathByCaptcha(imageBase64);
        default:
          return { success: false, error: `Unknown solver type: ${this.type}` };
      }
    } catch (error: any) {
      logger.error(`❌ Image captcha solving error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 2Captcha - 图像验证码
   */
  private async solveImageCaptcha_2Captcha(imageBase64: string): Promise<{ success: boolean; text?: string; error?: string }> {
    try {
      const uploadRes = await axios.post('http://2captcha.com/api/upload', {
        apikey: this.apiKey,
        captchafile: `data:image/png;base64,${imageBase64}`,
        method: 'base64',
      });

      if (uploadRes.data.is_correct === 0) {
        return { success: false, error: uploadRes.data.error };
      }

      const captchaId = uploadRes.data.captcha;

      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000));

        const resultRes = await axios.get('http://2captcha.com/api/res', {
          params: {
            apikey: this.apiKey,
            captcha_id: captchaId,
            json: 1,
          },
        });

        if (resultRes.data.status === 0) continue;
        if (resultRes.data.status === 1) {
          logger.info(`✅ 2Captcha image captcha solved: ${resultRes.data.request}`);
          return { success: true, text: resultRes.data.request };
        }

        return { success: false, error: resultRes.data.error };
      }

      return { success: false, error: 'Timeout' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Anti-Captcha - 图像验证码
   */
  private async solveImageCaptcha_AntiCaptcha(imageBase64: string): Promise<{ success: boolean; text?: string; error?: string }> {
    try {
      const createRes = await axios.post('https://api.anti-captcha.com/createTask', {
        clientKey: this.apiKey,
        task: {
          type: 'ImageToTextTask',
          body: imageBase64,
          phrase: false,
          case: false,
          numeric: 0,
          math: false,
          minLength: 0,
          maxLength: 0,
        },
      });

      if (!createRes.data.taskId) {
        return { success: false, error: createRes.data.errorDescription };
      }

      const taskId = createRes.data.taskId;

      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000));

        const resultRes = await axios.post('https://api.anti-captcha.com/getTaskResult', {
          clientKey: this.apiKey,
          taskId: taskId,
        });

        if (resultRes.data.isDone === false) continue;
        if (resultRes.data.solution) {
          logger.info(`✅ Anti-Captcha image captcha solved: ${resultRes.data.solution.text}`);
          return { success: true, text: resultRes.data.solution.text };
        }

        return { success: false, error: resultRes.data.errorDescription };
      }

      return { success: false, error: 'Timeout' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * DeathByCaptcha - 图像验证码
   */
  private async solveImageCaptcha_DeathByCaptcha(imageBase64: string): Promise<{ success: boolean; text?: string; error?: string }> {
    try {
      const createRes = await axios.post('http://deathbycaptcha.com/api/captcha', {
        captchafile: `base64:${imageBase64}`,
        username: process.env.DBC_USERNAME || '',
        password: process.env.DBC_PASSWORD || '',
      });

      if (!createRes.data.captcha) {
        return { success: false, error: createRes.data.error };
      }

      const captchaId = createRes.data.captcha;

      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000));

        const resultRes = await axios.get(`http://deathbycaptcha.com/api/captcha/${captchaId}`, {
          auth: {
            username: process.env.DBC_USERNAME || '',
            password: process.env.DBC_PASSWORD || '',
          },
        });

        if (resultRes.data.is_correct === false && resultRes.data.text) {
          logger.info(`✅ DeathByCaptcha image captcha solved: ${resultRes.data.text}`);
          return { success: true, text: resultRes.data.text };
        }

        if (resultRes.data.is_correct !== false) continue;
      }

      return { success: false, error: 'Timeout' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取账户余额（检查服务可用性）
   */
  async getBalance(): Promise<{ success: boolean; balance?: number; error?: string }> {
    try {
      logger.info(`💰 Checking balance on ${this.type}...`);

      switch (this.type) {
        case '2captcha':
          const res2 = await axios.get('http://2captcha.com/api/user', {
            params: { apikey: this.apiKey, json: 1 },
          });
          return { success: true, balance: parseFloat(res2.data.balance) || 0 };

        case 'anticaptcha':
          const resA = await axios.post('https://api.anti-captcha.com/getBalance', {
            clientKey: this.apiKey,
          });
          return { success: true, balance: resA.data.balance || 0 };

        case 'deathbycaptcha':
          const resD = await axios.get('http://deathbycaptcha.com/api/user', {
            auth: {
              username: process.env.DBC_USERNAME || '',
              password: process.env.DBC_PASSWORD || '',
            },
          });
          return { success: true, balance: resD.data.balance || 0 };

        default:
          return { success: false, error: `Unknown solver type: ${this.type}` };
      }
    } catch (error: any) {
      logger.error(`❌ Balance check error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

// 工厂函数 - 基于环境变量自动创建
export function createCaptchaSolver(): CaptchaSolver | null {
  const solverType = (process.env.CAPTCHA_SOLVER_TYPE || '2captcha') as CaptchaSolverType;
  const apiKey = process.env[`CAPTCHA_${solverType.toUpperCase()}_API_KEY`] || '';

  if (!apiKey) {
    logger.warn(`⚠️ No API key found for ${solverType}. Captcha solving disabled.`);
    return null;
  }

  return new CaptchaSolver({ type: solverType, apiKey });
}

export default CaptchaSolver;
