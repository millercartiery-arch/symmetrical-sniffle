
import { Page } from 'puppeteer';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'puppeteer-sender' },
    transports: [
        new winston.transports.Console()
    ]
});

// Mock service for now - replace with real 2captcha implementation
async function solveCaptcha(imageUrl: string): Promise<string> {
    logger.info('Solving captcha (mock)...');
    return '123456'; 
}

export async function performSend(page: Page, data: any) {
    const { account, targetPhone, content } = data;
    const { username, password, proxy_url } = account;

    logger.info(`Starting Puppeteer Send for ${username} -> ${targetPhone}`);

    // 1. Authenticate Proxy (if needed)
    if (proxy_url) {
        // Parse proxy url for auth
        // await page.authenticate({ username: '...', password: '...' });
    }

    // 2. Login
    await page.goto('https://www.textnow.com/login', { waitUntil: 'networkidle2' });
    
    // Check if already logged in (by cookie)
    if (page.url().includes('/messaging')) {
        logger.info('Already logged in');
    } else {
        await page.type('#email', username, { delay: 100 });
        await page.type('#password', password, { delay: 100 });
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#loginBtn'),
        ]);

        // Captcha Handling
        const captchaFrame = page.frames().find(f => f.url().includes('captcha'));
        if (captchaFrame) {
            logger.info('Captcha detected');
            const img = await captchaFrame.$('img.captcha-image');
            if (img) {
                const src = await img.evaluate((el: any) => el.src);
                const solution = await solveCaptcha(src);
                await captchaFrame.type('#captchaInput', solution);
                await captchaFrame.click('#submitCaptcha');
                await page.waitForNavigation();
            }
        }
    }

    // 3. Send Message
    await page.goto('https://www.textnow.com/messaging', { waitUntil: 'networkidle2' });
    
    // New Message
    await page.click('#newMessageBtn');
    await page.type('#recipientInput', targetPhone, { delay: 80 });
    await page.type('#messageBox', content, { delay: 80 });
    
    await Promise.all([
        page.waitForResponse(resp => resp.url().includes('/api/v1/message') && resp.status() === 200),
        page.click('#sendBtn'),
    ]);

    // Verify Success UI
    // const successToast = await page.waitForSelector('.toast-success', { timeout: 5000 });
    // if (!successToast) throw new Error('Message sent confirmation missing');
    
    logger.info(`Message sent to ${targetPhone}`);
}
