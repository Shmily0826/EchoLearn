// @vitest-environment jsdom
/**
 * Data export.
 *
 * Export is the learner's escape hatch out of the app, so the file itself is the
 * user-facing behaviour: a definition containing a comma, a quote or a newline
 * must not shift columns in Excel, Chinese must survive the round trip, and the
 * JSON backup must carry every study collection under a versioned envelope.
 *
 * Note: this JSON stores parsed values, while the Gist restore in syncService
 * expects raw localStorage strings, and the app has no JSON file import. These
 * tests pin the file contents only, not a restore round trip.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SentenceItem, VocabularyItem } from '../../types';
import { exportAllDataJSON, exportSentencesCSV, exportVocabularyCSV } from '../exportService';

const captured: Blob[] = [];
const filenames: string[] = [];

async function readBlob(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Raw bytes of the most recent export (decoding swallows the BOM, so inspect bytes). */
async function lastExportBytes(): Promise<Uint8Array> {
  const blob = captured[captured.length - 1];
  return new Uint8Array(await blob.arrayBuffer());
}

/** Text of the most recent, first-textual export. */
async function lastExport(): Promise<{ text: string; filename: string }> {
  const blob = captured[captured.length - 1];
  return { text: await readBlob(blob), filename: filenames[filenames.length - 1] };
}

function vocab(overrides: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: 'v1',
    word: 'bank',
    meaningCn: '银行',
    context: 'I went to the bank yesterday.',
    sourceVideoId: 'vid_1',
    addedAt: Date.UTC(2026, 0, 15),
    mastered: false,
    reviewCount: 2,
    lastReviewedAt: 0,
    nextReviewAt: 0,
    ...overrides,
  };
}

function sentence(overrides: Partial<SentenceItem> = {}): SentenceItem {
  return {
    id: 's1',
    text: 'I went to the bank yesterday.',
    meaningCn: '我昨天去了银行。',
    sourceVideoId: 'vid_1',
    startTime: 12,
    addedAt: Date.UTC(2026, 0, 15),
    myOwnSentence: '',
    mastered: false,
    reviewCount: 0,
    lastReviewedAt: 0,
    nextReviewAt: 0,
    ...overrides,
  };
}

describe('CSV / JSON export', () => {
  beforeEach(() => {
    captured.length = 0;
    filenames.length = 0;
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        captured.push(blob);
        return 'blob:mock';
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      filenames.push(this.download);
    });
  });

  it('quotes a meaning that contains a comma, a quote and a newline so columns stay aligned', async () => {
    exportVocabularyCSV([vocab({ meaningCn: 'a, "quoted", multi\nline' })], 'zh');
    const { text } = await lastExport();

    // A field with separators must be wrapped in quotes and have its own quotes
    // doubled — otherwise the row splits into extra columns/records.
    expect(text).toContain('"a, ""quoted"", multi\nline"');
    expect(text).not.toContain('"a, "quoted"');
  });

  it('writes a UTF-8 BOM so Excel renders the Chinese column instead of mojibake', async () => {
    exportVocabularyCSV([vocab()], 'zh');
    const bytes = await lastExportBytes();
    const { text } = await lastExport();

    // EF BB BF is the UTF-8 BOM. Without it Excel mis-decodes the Chinese column.
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain('银行');
    expect(text).toContain('Meaning (CN)');
  });

  it('drops the Chinese meaning column in English study mode', async () => {
    exportVocabularyCSV([vocab()], 'en');
    const english = (await lastExport()).text;

    exportVocabularyCSV([vocab()], 'zh');
    const chinese = (await lastExport()).text;

    const englishHeader = english.replace('\uFEFF', '').split('\n')[0];
    expect(englishHeader).not.toContain('Meaning (CN)');
    expect(englishHeader).toContain('Definition (EN)');
    // English mode still exports every word — it just stops leaking Chinese.
    expect(englishHeader.split(',')).toHaveLength(8);
    expect(chinese.replace('\uFEFF', '').split('\n')[0].split(',')).toHaveLength(9);
  });

  it('exports sentences with their translation in zh mode and without it in en mode', async () => {
    exportSentencesCSV([sentence()], 'zh');
    const zh = (await lastExport()).text;
    exportSentencesCSV([sentence()], 'en');
    const en = (await lastExport()).text;

    expect(zh).toContain('我昨天去了银行。');
    expect(en).not.toContain('我昨天去了银行。');
    expect(en.replace('\uFEFF', '').split('\n')[0]).toContain('Sentence');
  });

  it('writes a versioned JSON backup that carries the saved words and sentences', async () => {
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([vocab()]));
    localStorage.setItem('echolearn_sentences', JSON.stringify([sentence()]));

    exportAllDataJSON();
    const { text, filename } = await lastExport();
    const payload = JSON.parse(text) as { version: number; data: Record<string, unknown> };

    expect(filename).toMatch(/^echolearn-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(payload.version).toBe(1);
    expect(payload.data.echolearn_vocabulary).toEqual([vocab()]);
    expect(payload.data.echolearn_sentences).toEqual([sentence()]);
  });

  it('keeps unparseable stored values in the JSON backup instead of dropping them', async () => {
    // A partially written value should still be recoverable by the user.
    localStorage.setItem('echolearn_vocabulary', '[{"id":"truncated"');
    localStorage.setItem('echolearn_sentences', JSON.stringify([sentence()]));

    exportAllDataJSON();
    const payload = JSON.parse((await lastExport()).text) as { data: Record<string, unknown> };

    expect(payload.data.echolearn_vocabulary).toBe('[{"id":"truncated"');
  });
});
