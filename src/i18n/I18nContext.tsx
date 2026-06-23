import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { t, type Lang } from './translations';

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const LANG_KEY = 'echolearn_lang';

function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'zh') return 'zh';
  } catch { /* noop */ }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    try { localStorage.setItem(LANG_KEY, newLang); } catch { /* noop */ }
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next = prev === 'en' ? 'zh' : 'en';
      try { localStorage.setItem(LANG_KEY, next); } catch { /* noop */ }
      return next;
    });
  }, []);

  const translate = useCallback(
    (key: string, vars?: Record<string, string | number>) => t(key, lang, vars),
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t: translate }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
