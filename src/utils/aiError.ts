import { t, type Lang } from '../i18n/translations';

/**
 * Keep unexpected AI failures useful without exposing provider or proxy
 * response bodies. Rate-limit and gate messages are already actionable and
 * localized, so they are preserved/mapped.
 */
export function safeAiErrorMessage(error: unknown, lang: Lang): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (code === 'email_not_verified') {
    return lang === 'zh'
      ? '请先验证邮箱后再使用 AI 功能（请查收验证邮件）。'
      : 'Please verify your email to use AI features (check your inbox).';
  }
  if (code === 'quota_exceeded') {
    return lang === 'zh'
      ? '今日 AI 使用次数已达上限，明天再来。'
      : 'Daily AI quota reached. Please try again tomorrow.';
  }
  const message = error instanceof Error ? error.message : '';
  const isRateLimit = lang === 'zh'
    ? message.startsWith('AI 使用过于频繁')
    : message.startsWith('Too many AI requests.');
  return isRateLimit ? message : t('ai.analysisFailed', lang);
}
