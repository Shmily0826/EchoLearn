// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AIAnalysisPanel from './AIAnalysisPanel';
import { I18nProvider } from '../i18n/I18nContext';
import type { AIAnalysisResult } from '../types';

const rawDiagnostic = '[deepseek-chat] DeepSeek API error 500: {"error":{"message":"upstream details"}}';

const fallbackAnalysis: AIAnalysisResult = {
  summaryEn: 'A transcript-based summary.',
  summaryCn: '基于字幕的摘要。',
  keyTakeaways: [],
  vocabularySuggestions: [],
  sentenceSuggestions: [],
  learningTasks: [],
  error: rawDiagnostic,
};

describe('AIAnalysisPanel fallback presentation', () => {
  afterEach(() => cleanup());

  it('shows a useful localized fallback message without exposing provider diagnostics', () => {
    render(
      <I18nProvider>
        <AIAnalysisPanel
          analysis={fallbackAnalysis}
          videoId="video-123"
          onAddVocabulary={vi.fn()}
          onAddSentence={vi.fn()}
          savedWords={new Set()}
          savedSentences={new Set()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('AI service unavailable — showing local transcript-based analysis. Try again later for AI-generated translations.')).toBeTruthy();
    expect(screen.queryByText(rawDiagnostic)).toBeNull();
    expect(document.body.textContent).not.toContain('upstream details');
  });

  it('uses the same safe fallback contract in Chinese', () => {
    localStorage.setItem('echolearn_lang', 'zh');

    render(
      <I18nProvider>
        <AIAnalysisPanel
          analysis={fallbackAnalysis}
          videoId="video-123"
          onAddVocabulary={vi.fn()}
          onAddSentence={vi.fn()}
          savedWords={new Set()}
          savedSentences={new Set()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('AI 服务暂时不可用，当前显示基于字幕的本地分析。稍后重试可获取 AI 翻译。')).toBeTruthy();
    expect(document.body.textContent).not.toContain('upstream details');
  });
});
