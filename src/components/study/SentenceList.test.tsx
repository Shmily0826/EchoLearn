// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SentenceList from './SentenceList';
import { I18nProvider } from '../../i18n/I18nContext';
import type { SentenceItem } from '../../types';

const sentence = (overrides: Partial<SentenceItem>): SentenceItem => ({
  id: 'sent-1',
  text: 'And the only way we will do it is by seeing our creative capacities.',
  meaningCn: '我们做到这一点的唯一方法，就是认识到我们创造力的丰富本质。',
  sourceVideoId: 'iG9CE55wbtY',
  sourceVideoTitle: 'Do schools kill creativity?',
  startTime: 566,
  addedAt: 1_760_000_000_000,
  myOwnSentence: '',
  mastered: false,
  reviewCount: 0,
  lastReviewedAt: 0,
  nextReviewAt: 1_760_086_400_000,
  ...overrides,
});

const renderList = (items: SentenceItem[], onSeek = vi.fn()) => {
  render(
    <I18nProvider>
      <SentenceList items={items} onRemove={vi.fn()} onSeek={onSeek} />
    </I18nProvider>,
  );
  return onSeek;
};

describe('SentenceList seek control', () => {
  afterEach(() => cleanup());

  it('offers a seek control for a sentence with a confirmed moment', () => {
    renderList([sentence({ startTime: 566 })]);

    const control = screen.getByText('@9:26');
    expect(control).toBeTruthy();
    expect(control.tagName).toBe('BUTTON');
  });

  it('never invents a moment for a sentence saved without one', () => {
    // 0 is the sentinel for "no confirmed moment" — set by AIAnalysisPanel when
    // the aligner could not place a suggestion, and by storage.ts when restoring
    // legacy data. The row must still render, just without a timestamp.
    renderList([sentence({ startTime: 0, text: 'An unplaceable quoted sentence.' })]);

    expect(screen.getByText('An unplaceable quoted sentence.')).toBeTruthy();
    expect(screen.queryByText('@0:00')).toBeNull();
    expect(screen.queryByTitle('Jump to this point in the video')).toBeNull();
  });

  it('lists a placed and an unplaced sentence side by side with one control', () => {
    const onSeek = renderList([
      sentence({ id: 'placed', startTime: 566, text: 'A placed sentence.' }),
      sentence({ id: 'unplaced', startTime: 0, text: 'An unplaced sentence.' }),
    ]);

    expect(screen.getAllByTitle('Jump to this point in the video')).toHaveLength(1);
    expect(screen.queryByText('@0:00')).toBeNull();

    fireEvent.click(screen.getByText('@9:26'));
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(566);
  });
});
