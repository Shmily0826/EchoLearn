import { t, type Lang } from '../i18n/translations';

/**
 * Keep unexpected AI failures useful without exposing provider or proxy
 * response bodies. Rate-limit messages are already actionable and localized,
 * so they are preserved.
 */
export function safeAiErrorMessage(error: unknown, lang: Lang): string {
  const message = error instanceof Error ? error.message : '';
  const isRateLimit = lang === 'zh'
    ? message.startsWith('AI 使用过于频繁')
    : message.startsWith('Too many AI requests.');
  return isRateLimit ? message : t('ai.analysisFailed', lang);
}
