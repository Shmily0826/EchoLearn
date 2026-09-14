import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { CEFR_LEVELS, type CEFRLevel } from '../../services/cefrWordList';

/**
 * Secondary Study settings — sleep timer, CEFR level range and the transcript
 * recovery action.
 *
 * These are session-level / recovery controls. They were previously rendered
 * as first-class controls next to the transcript, competing with the actual
 * learning area. They keep exactly the same behaviour here; only their visual
 * weight changes.
 */
const TIMER_PRESETS = [0, 15, 30, 45, 60];

export interface StudySettingsMenuProps {
  sleepMinutes: number;
  onSleepMinutesChange: (minutes: number) => void;
  cefrMin: CEFRLevel;
  onCefrMinChange: (level: CEFRLevel) => void;
  cefrMax: CEFRLevel;
  onCefrMaxChange: (level: CEFRLevel) => void;
  onReloadTranscript: () => void;
  reloadDisabled?: boolean;
}

const StudySettingsMenu: React.FC<StudySettingsMenuProps> = ({
  sleepMinutes,
  onSleepMinutesChange,
  cefrMin,
  onCefrMinChange,
  cefrMax,
  onCefrMaxChange,
  onReloadTranscript,
  reloadDisabled = false,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (!returnFocus) return;
    const panel = panelRef.current;
    if (panel && panel.contains(document.activeElement)) {
      triggerRef.current?.focus();
    }
  }, []);

  // Escape closes the panel and hands focus back to the trigger, so keyboard
  // behaviour after collapsing the controls does not regress.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const panelId = 'study-settings-panel';

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-testid="study-settings-toggle"
        data-tour="study-controls"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        title={t('study.studySettings')}
        className={`flex items-center gap-1 px-2 py-1 text-[10px] sm:text-[11px] font-medium rounded-lg border transition-colors cursor-pointer ${
          open
            ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800'
            : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400'
        }`}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
          />
        </svg>
        {t('study.studySettings')}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={t('study.studySettings')}
          tabIndex={-1}
          data-testid="study-settings-panel"
          className="absolute right-0 top-full mt-1 z-30 w-72 max-w-[calc(100vw-2rem)] p-3 space-y-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg focus:outline-none"
        >
          {/* Sleep timer — session-level, kept fully functional */}
          <div role="group" aria-label={t('study.timer')}>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {t('study.timer')}
            </p>
            <div className="flex items-center gap-1">
              {TIMER_PRESETS.map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => onSleepMinutesChange(min)}
                  aria-label={min === 0 ? t('study.timerOff') : t('study.timerMin', { n: min })}
                  aria-pressed={sleepMinutes === min}
                  className={`flex-1 px-1 py-1 text-[10px] rounded transition-colors cursor-pointer ${
                    sleepMinutes === min
                      ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {min === 0 ? t('study.timerOff') : `${min}`}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={180}
                placeholder="min"
                aria-label={t('study.timerCustom')}
                title={t('study.timerCustom')}
                value=""
                onChange={(e) => {
                  const v = Math.max(0, Math.min(180, Number(e.target.value) || 0));
                  if (v > 0) onSleepMinutesChange(v);
                  e.target.value = '';
                }}
                className="w-12 px-1 py-1 text-[10px] border border-gray-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none text-center"
              />
            </div>
          </div>

          {/* CEFR level range — analysis configuration */}
          <div role="group" aria-label={t('study.levelTooltip')}>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {t('study.level')}
            </p>
            <div className="flex items-center gap-1 text-[11px]">
              <select
                value={cefrMin}
                aria-label={t('study.levelMin')}
                title={t('study.levelTooltip')}
                onChange={(e) => {
                  const v = e.target.value as CEFRLevel;
                  onCefrMinChange(v);
                  if (CEFR_LEVELS.indexOf(v) > CEFR_LEVELS.indexOf(cefrMax)) onCefrMaxChange(v);
                }}
                className="flex-1 px-1.5 py-1 border border-gray-200 dark:border-slate-700 rounded text-[11px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 cursor-pointer"
              >
                {CEFR_LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <span className="text-gray-300 dark:text-gray-500">–</span>
              <select
                value={cefrMax}
                aria-label={t('study.levelMax')}
                title={t('study.levelTooltip')}
                onChange={(e) => {
                  const v = e.target.value as CEFRLevel;
                  onCefrMaxChange(v);
                  if (CEFR_LEVELS.indexOf(v) < CEFR_LEVELS.indexOf(cefrMin)) onCefrMinChange(v);
                }}
                className="flex-1 px-1.5 py-1 border border-gray-200 dark:border-slate-700 rounded text-[11px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 cursor-pointer"
              >
                {CEFR_LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Recovery action */}
          <div className="pt-1 border-t border-gray-100 dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                onReloadTranscript();
                close(false);
              }}
              disabled={reloadDisabled}
              title={t('study.reloadTranscript')}
              className="flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] text-gray-500 dark:text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {t('study.reloadTranscript')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudySettingsMenu;
