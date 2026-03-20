import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

type Theme = 'light' | 'dark' | 'high-contrast';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  brandColor: string;
  setBrandColor: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'light';
  });
  const [brandColor, setBrandColor] = useState<string>(() => {
    const saved = localStorage.getItem('brandColor');
    if (!saved || saved === '#1890ff' || saved === '#0052D9' || saved === '#10a37f' || saved === '#8B0000') {
      return '#55616c';
    }
    return saved;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--brand-color', brandColor);
    document.documentElement.style.setProperty('--cm-brand-color', brandColor);
    localStorage.setItem('brandColor', brandColor);
  }, [brandColor]);

  useEffect(() => {
    const language = i18n.resolvedLanguage || i18n.language || 'en-US';
    document.documentElement.setAttribute('lang', language);
    document.documentElement.setAttribute('dir', i18n.dir(language));
  }, [i18n, i18n.language, i18n.resolvedLanguage]);

  useEffect(() => {
    const syncLanguage = (language: string) => {
      document.documentElement.setAttribute('lang', language);
      document.documentElement.setAttribute('dir', i18n.dir(language));
    };

    i18n.on('languageChanged', syncLanguage);
    return () => {
      i18n.off('languageChanged', syncLanguage);
    };
  }, [i18n]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, brandColor, setBrandColor }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
