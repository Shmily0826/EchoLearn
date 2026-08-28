import { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { TOUR_LANG_CHOSEN_KEY } from './tourEvents';

/**
 * First-ever-visit language picker. Shows a modal before anything else so the
 * user chooses EN / 中文. If a language is already
 * stored (returning user) or the choice was previously made, it renders nothing.
 */
const LanguageChooser: React.FC = () => {
  const { t, setLang, lang } = useI18n();
  const [open, setOpen] = useState(() => {
    const storedLang = localStorage.getItem('echolearn_lang');
    const alreadyChosen = localStorage.getItem(TOUR_LANG_CHOSEN_KEY);
    if (storedLang || alreadyChosen) {
      if (storedLang && !alreadyChosen) {
        localStorage.setItem(TOUR_LANG_CHOSEN_KEY, '1');
      }
      return false;
    }
    return true;
  });

  const choose = (picked: 'en' | 'zh') => {
    setLang(picked);
    localStorage.setItem(TOUR_LANG_CHOSEN_KEY, '1');
    setOpen(false);
  };

  const skip = () => {
    localStorage.setItem(TOUR_LANG_CHOSEN_KEY, '1');
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.6)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl p-6 text-center"
      >
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1">
          {t('lang.title')}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
          {t('lang.subtitle')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => choose('en')}
            className={`py-3 rounded-xl text-base font-semibold border transition-colors cursor-pointer ${
              lang === 'en'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-slate-600 hover:border-indigo-400'
            }`}
          >
            {t('lang.en')}
          </button>
          <button
            onClick={() => choose('zh')}
            className={`py-3 rounded-xl text-base font-semibold border transition-colors cursor-pointer ${
              lang === 'zh'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-slate-600 hover:border-indigo-400'
            }`}
          >
            {t('lang.zh')}
          </button>
        </div>
        <button
          type="button"
          onClick={skip}
          className="mt-4 text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-300 underline underline-offset-2 cursor-pointer"
        >
          {t('lang.skip')}
        </button>
      </div>
    </div>
  );
};

export default LanguageChooser;
