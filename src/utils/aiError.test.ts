import { describe, expect, it } from 'vitest';
import { safeAiErrorMessage } from './aiError';

describe('safeAiErrorMessage', () => {
  it('replaces unexpected provider errors with a localized learner message', () => {
    expect(safeAiErrorMessage(new Error('DeepSeek API error 500: upstream details'), 'en')).toBe(
      'AI analysis could not be completed. Please try again later.',
    );
    expect(safeAiErrorMessage(new Error('proxy response body'), 'zh')).toBe('AI 分析未完成，请稍后重试。');
    expect(safeAiErrorMessage('unstructured provider error', 'en')).toBe(
      'AI analysis could not be completed. Please try again later.',
    );
  });

  it('preserves actionable localized rate-limit guidance', () => {
    expect(safeAiErrorMessage(new Error('Too many AI requests. Please wait 9s and try again.'), 'en')).toBe(
      'Too many AI requests. Please wait 9s and try again.',
    );
    expect(safeAiErrorMessage(new Error('AI 使用过于频繁，请 9 秒后再试。'), 'zh')).toBe('AI 使用过于频繁，请 9 秒后再试。');
  });
});
