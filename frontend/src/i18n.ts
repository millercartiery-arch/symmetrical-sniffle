import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: ['en-US', 'zh-CN'],
    load: 'languageOnly',
    cleanCode: true,
    lowerCaseLng: false,
    fallbackLng: 'en-US',
    nonExplicitSupportedLngs: true,
    resources: {
      'en-US': { translation: enUS },
      'zh-CN': { translation: zhCN }
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
