/**
 * Simple Google Translate API Service
 * Uses API Key for simplicity
 */

import https from 'https';
import querystring from 'querystring';

type TranslateResult = { translatedText: string; detectedLanguage?: string };

const requestText = (
  options: https.RequestOptions,
  body?: string,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

const translateWithOfficialApi = async (
  texts: string[],
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<TranslateResult[]> => {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_TRANSLATE_API_KEY not configured');
  }

  const results: TranslateResult[] = [];
  const batchSize = 100;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const params = querystring.stringify({
      key: apiKey,
      q: batch.join('\n'),
      target: targetLanguage,
      source: sourceLanguage || '',
      format: 'text',
    });

    const response = await requestText(
      {
        hostname: 'translation.googleapis.com',
        path: '/language/translate/v2',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(params),
        },
      },
      params,
    );

    const result = JSON.parse(response);
    if (result.error) {
      throw new Error(result.error.message);
    }

    if (result.data && result.data.translations) {
      result.data.translations.forEach((t: any) => {
        results.push({
          translatedText: t.translatedText,
          detectedLanguage: t.detectedSourceLanguage,
        });
      });
    }
  }

  return results;
};

const parseUnofficialTranslateResponse = (payload: string): TranslateResult => {
  const parsed = JSON.parse(payload);
  const translatedText = Array.isArray(parsed?.[0])
    ? parsed[0].map((chunk: any) => String(chunk?.[0] || '')).join('')
    : '';
  const detectedLanguage = typeof parsed?.[2] === 'string' ? parsed[2] : undefined;
  return {
    translatedText,
    detectedLanguage,
  };
};

const translateWithFallbackApi = async (
  texts: string[],
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<TranslateResult[]> => {
  const results: TranslateResult[] = [];

  for (const text of texts) {
    const params = querystring.stringify({
      client: 'gtx',
      sl: sourceLanguage || 'auto',
      tl: targetLanguage,
      dt: 't',
      q: text,
    });

    const response = await requestText({
      hostname: 'translate.googleapis.com',
      path: `/translate_a/single?${params}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    results.push(parseUnofficialTranslateResponse(response));
  }

  return results;
};

/**
 * Translate text using Google Translate API (no-auth version)
 */
export async function translateText(
  text: string | string[],
  targetLanguage: string,
  sourceLanguage?: string
) : Promise<TranslateResult[]> {
  const texts = Array.isArray(text) ? text : [text];

  try {
    return await translateWithOfficialApi(texts, targetLanguage, sourceLanguage);
  } catch (error: any) {
    const message = String(error?.message || error);
    console.warn('[translate] official API failed, falling back:', message);
    return translateWithFallbackApi(texts, targetLanguage, sourceLanguage);
  }
}

/**
 * Detect language of text
 */
export async function detectLanguage(
  text: string
): Promise<{ language: string; confidence: number }> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;

  try {
    if (!apiKey) {
      throw new Error('GOOGLE_TRANSLATE_API_KEY not configured');
    }

    const params = querystring.stringify({
      key: apiKey,
      q: text,
    });

    const response = await requestText(
      {
        hostname: 'translation.googleapis.com',
        path: '/language/translate/v2/detect',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(params),
        },
      },
      params,
    );

    const result = JSON.parse(response);
    if (result.error) {
      throw new Error(result.error.message);
    }

    const detected = result.data?.detections?.[0]?.[0];
    return {
      language: detected?.language || 'und',
      confidence: detected?.confidence || 0,
    };
  } catch (error: any) {
    const message = String(error?.message || error);
    console.warn('[translate] detect language fallback:', message);
    const [fallbackResult] = await translateWithFallbackApi([text], 'en');
    return {
      language: fallbackResult?.detectedLanguage || 'und',
      confidence: 0,
    };
  }
}

export default {
  translateText,
  detectLanguage,
};
