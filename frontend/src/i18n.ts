import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';

const flattenLocale = (input: Record<string, any>, prefix = ''): Record<string, string> => {
  const output: Record<string, string> = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(output, flattenLocale(value, nextKey));
      return;
    }
    output[nextKey] = String(value);
  });
  return output;
};

const enResources = flattenLocale(enUS as Record<string, any>);
const zhResources = flattenLocale(zhCN as Record<string, any>);

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: ['en-US', 'zh-CN'],
    load: 'all',
    cleanCode: true,
    lowerCaseLng: false,
    fallbackLng: 'en-US',
    resources: {
      'en-US': { translation: enResources },
      'zh-CN': { translation: zhResources }
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage']
    },
    react: {
      useSuspense: false
    },
    interpolation: {
      escapeValue: false
    },
    returnNull: false,
    returnEmptyString: false,
    pluralSeparator: '_'
  });

export default i18n;
