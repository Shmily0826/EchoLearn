import { describe, expect, it } from 'vitest';
import { t } from './translations';

describe('guest capability copy', () => {
  it('describes device-local learning and sign-in-only capabilities accurately', () => {
    expect(t('login.guestHint', 'en')).toBe(
      'Browse videos & subtitles freely. Save words and sentences on this device. Sign in to use AI and sync across devices.',
    );
    expect(t('settings.guestHint', 'en')).toBe(
      'Save vocabulary and sentences on this device. Sign in to sync across devices.',
    );
    expect(t('study.loginRequired', 'en')).toBe('Sign in to use AI analysis.');
    expect(t('study.invalidVideo', 'en')).toBe('Enter a valid YouTube or Bilibili video URL or ID.');
    expect(t('dash.onboardStep2', 'en')).toBe('Read the transcript, save words and sentences');
    expect(t('tour.studyAnalyzeBody', 'en')).toContain('Sign in to use AI analysis.');
  });

  it('keeps the same capability distinction in Chinese', () => {
    expect(t('login.guestHint', 'zh')).toBe('可自由浏览视频和字幕，词汇和句子会保存在本设备。登录后可使用 AI 分析并跨设备同步。');
    expect(t('settings.guestHint', 'zh')).toBe('词汇和句子会保存在本设备。登录后可跨设备同步数据。');
    expect(t('study.loginRequired', 'zh')).toBe('登录后可使用 AI 分析。');
  });
});
