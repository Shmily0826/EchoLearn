import type { VocabularyItem, SentenceItem } from '../types';

// ─── CSV helpers ─────────────────────────────────────────────

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
  // Prepend UTF-8 BOM so Excel correctly handles Chinese characters in CSV
  const blob = new Blob(['\uFEFF' + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Vocabulary export ──────────────────────────────────────

export function exportVocabularyCSV(items: VocabularyItem[]): void {
  const header = 'Word,Meaning (CN),Part of Speech,Definition (EN),Context,Source Video,Date Added,Mastered,Review Count';
  const rows = items.map((v) =>
    [
      v.word,
      v.meaningCn,
      v.partOfSpeech || '',
      v.definitionEn || '',
      v.context,
      v.sourceVideoTitle || v.sourceVideoId,
      new Date(v.addedAt).toLocaleDateString(),
      v.mastered ? 'Yes' : 'No',
      String(v.reviewCount),
    ]
      .map(escapeCSV)
      .join(','),
  );
  downloadBlob([header, ...rows].join('\n'), `echolearn_vocabulary_${dateStamp()}.csv`, 'text/csv;charset=utf-8');
}

export function exportVocabularyPDF(items: VocabularyItem[]): void {
  const rows = items
    .map(
      (v) => `
      <tr>
        <td class="word">${esc(v.word)}</td>
        <td>${esc(v.meaningCn || '-')}</td>
        <td class="pos">${esc(v.partOfSpeech || '')}</td>
        <td class="ctx">${esc(truncate(v.context, 80))}</td>
        <td class="status">${v.mastered ? '✓' : `${v.reviewCount}/5`}</td>
      </tr>`,
    )
    .join('');

  const html = buildPDFHTML(
    'Vocabulary List',
    `<table>
      <thead><tr><th>Word</th><th>Meaning</th><th>POS</th><th>Context</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`,
  );
  openPrintWindow(html);
}

// ─── Sentences export ───────────────────────────────────────

export function exportSentencesCSV(items: SentenceItem[]): void {
  const header = 'Sentence,Meaning (CN),My Own Sentence,Source Video,Date Added,Mastered,Review Count';
  const rows = items.map((s) =>
    [
      s.text,
      s.meaningCn,
      s.myOwnSentence || '',
      s.sourceVideoTitle || s.sourceVideoId,
      new Date(s.addedAt).toLocaleDateString(),
      s.mastered ? 'Yes' : 'No',
      String(s.reviewCount),
    ]
      .map(escapeCSV)
      .join(','),
  );
  downloadBlob([header, ...rows].join('\n'), `echolearn_sentences_${dateStamp()}.csv`, 'text/csv;charset=utf-8');
}

export function exportSentencesPDF(items: SentenceItem[]): void {
  const rows = items
    .map(
      (s) => `
      <tr>
        <td class="ctx">${esc(truncate(s.text, 100))}</td>
        <td>${esc(s.meaningCn || '-')}</td>
        <td class="ctx">${esc(truncate(s.myOwnSentence || '', 80))}</td>
        <td class="status">${s.mastered ? '✓' : `${s.reviewCount}/5`}</td>
      </tr>`,
    )
    .join('');

  const html = buildPDFHTML(
    'Sentence Bank',
    `<table>
      <thead><tr><th>Sentence</th><th>Meaning</th><th>My Own</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`,
  );
  openPrintWindow(html);
}

// ─── Full JSON export ──────────────────────────────────────

export function exportAllDataJSON(): void {
  const keys = [
    'echolearn_vocabulary',
    'echolearn_sentences',
    'echolearn_session',
    'echolearn_sessions_list',
    'echolearn_daily_plan',
  ] as const;

  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        data[key] = JSON.parse(raw);
      } catch {
        data[key] = raw;
      }
    }
  }

  const payload = {
    version: 1,
    exportedAt: Date.now(),
    data,
  };

  downloadBlob(
    JSON.stringify(payload, null, 2),
    `echolearn-backup-${dateStamp()}.json`,
    'application/json',
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function openPrintWindow(html: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  // Wait for styles to load then print
  setTimeout(() => {
    win.print();
  }, 300);
}

function buildPDFHTML(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title} — EchoLearn</title>
<style>
  @page { margin: 1.5cm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1a1a1a; padding: 20px; }
  h1 { font-size: 20px; margin-bottom: 4px; color: #4338ca; }
  .meta { font-size: 11px; color: #888; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #f3f4f6; text-align: left; padding: 6px 8px; border-bottom: 2px solid #d1d5db; font-weight: 600; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .word { font-weight: 600; color: #4338ca; }
  .pos { color: #6366f1; font-style: italic; }
  .ctx { color: #555; font-size: 10px; line-height: 1.4; }
  .status { text-align: center; font-weight: 600; color: #059669; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">Exported from EchoLearn · ${new Date().toLocaleDateString()}</p>
  ${body}
</body>
</html>`;
}
