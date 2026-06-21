import React, { useState, useRef, useCallback } from 'react';
import type { TranscriptLine } from '../types';
import { parseTranscript } from '../utils/transcriptParser';

interface TranscriptImporterProps {
  onImport: (lines: TranscriptLine[]) => void;
}

// ── Time format helpers ──────────────────────────────────────

function secondsToDisplay(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 10);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

function displayToSeconds(display: string): number {
  const cleaned = display.replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }
  return parseFloat(cleaned) || 0;
}

// ── Component ────────────────────────────────────────────────

const TranscriptImporter: React.FC<TranscriptImporterProps> = ({ onImport }) => {
  const [rawText, setRawText] = useState('');
  const [previewLines, setPreviewLines] = useState<TranscriptLine[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Parse pasted text ────────────────────────────────────
  const handlePreview = useCallback(() => {
    if (!rawText.trim()) return;
    const parsed = parseTranscript(rawText);
    if (parsed.length > 0) {
      setPreviewLines(parsed);
    }
  }, [rawText]);

  // ── File upload ──────────────────────────────────────────
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (!text) return;
        setRawText(text);
        const parsed = parseTranscript(text);
        if (parsed.length > 0) {
          setPreviewLines(parsed);
        }
      };
      reader.readAsText(file);
    },
    [],
  );

  // ── Edit helpers ─────────────────────────────────────────
  const updateLine = useCallback(
    (idx: number, patch: Partial<TranscriptLine>) => {
      if (!previewLines) return;
      setPreviewLines(
        previewLines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
      );
    },
    [previewLines],
  );

  const removeLine = useCallback(
    (idx: number) => {
      if (!previewLines) return;
      setPreviewLines(previewLines.filter((_, i) => i !== idx));
    },
    [previewLines],
  );

  const addLineAfter = useCallback(
    (idx: number) => {
      if (!previewLines) return;
      const prev = previewLines[idx];
      const newLine: TranscriptLine = {
        id: `tl_new_${Date.now()}`,
        start: prev.end,
        end: prev.end + 5,
        text: '',
      };
      const next = [...previewLines];
      next.splice(idx + 1, 0, newLine);
      setPreviewLines(next);
    },
    [previewLines],
  );

  // ── Confirm / Cancel ─────────────────────────────────────
  const handleConfirm = useCallback(() => {
    if (previewLines && previewLines.length > 0) {
      onImport(previewLines);
    }
  }, [previewLines, onImport]);

  const handleCancel = useCallback(() => {
    setPreviewLines(null);
    setRawText('');
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-base font-semibold text-gray-800">
          Import Transcript
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Paste text, or upload an .srt / .vtt file. Supports SRT, VTT, timestamped, and plain text.
        </p>
      </div>

      <div className="p-5">
        {/* ── Step 1: Input ────────────────────────────────── */}
        {!previewLines && (
          <div className="space-y-4">
            {/* Textarea */}
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5 block">
                Paste Transcript
              </label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={
                  'Paste your transcript here...\n\n' +
                  'Supported formats:\n' +
                  '  SRT:    1\\n00:00:01,000 --> 00:00:05,000\\nHello world.\n' +
                  '  VTT:    WEBVTT\\n\\n00:00:01.000 --> 00:00:05.000\\nHello world.\n' +
                  '  Time:   0:01 Hello world.\n' +
                  '  Plain:  Hello world. (auto 5s per sentence)'
                }
                className="w-full h-48 px-3 py-2.5 text-sm font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
              />
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-gray-200" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 border-t border-gray-200" />
            </div>

            {/* File upload */}
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5 block">
                Upload File
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium cursor-pointer flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  Choose .srt / .vtt file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".srt,.vtt,.txt"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {fileName && (
                  <span className="text-xs text-gray-500">
                    {fileName}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handlePreview}
                disabled={!rawText.trim()}
                className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Preview Parsed Lines
              </button>
              {rawText.trim() && (
                <button
                  onClick={() => { setRawText(''); setFileName(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Preview & Edit ───────────────────────── */}
        {previewLines && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                <span className="font-semibold text-indigo-600">{previewLines.length}</span> lines parsed
              </p>
              <button
                onClick={handleCancel}
                className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                ← Back to input
              </button>
            </div>

            {/* Editable table */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[80px_80px_1fr_80px] bg-gray-50 border-b border-gray-200 px-3 py-2 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                <span>Start</span>
                <span>End</span>
                <span>Text</span>
                <span className="text-right">Actions</span>
              </div>

              {/* Rows */}
              <div className="divide-y divide-gray-100">
                {previewLines.map((line, idx) => (
                  <div
                    key={line.id || idx}
                    className="grid grid-cols-[80px_80px_1fr_80px] items-center gap-2 px-3 py-1.5 hover:bg-gray-50 transition-colors"
                  >
                    {/* Start time */}
                    <input
                      type="text"
                      value={secondsToDisplay(line.start)}
                      onChange={(e) =>
                        updateLine(idx, { start: displayToSeconds(e.target.value) })
                      }
                      className="w-full px-1.5 py-1 text-xs font-mono border border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none rounded bg-transparent"
                    />

                    {/* End time */}
                    <input
                      type="text"
                      value={secondsToDisplay(line.end)}
                      onChange={(e) =>
                        updateLine(idx, { end: displayToSeconds(e.target.value) })
                      }
                      className="w-full px-1.5 py-1 text-xs font-mono border border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none rounded bg-transparent"
                    />

                    {/* Text */}
                    <input
                      type="text"
                      value={line.text}
                      onChange={(e) => updateLine(idx, { text: e.target.value })}
                      className="w-full px-1.5 py-1 text-sm border border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none rounded bg-transparent truncate"
                    />

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => addLineAfter(idx)}
                        title="Add line after"
                        className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </button>
                      <button
                        onClick={() => removeLine(idx)}
                        title="Delete line"
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Add line at end */}
            <button
              onClick={() => {
                const last = previewLines[previewLines.length - 1];
                const newLine: TranscriptLine = {
                  id: `tl_new_${Date.now()}`,
                  start: last ? last.end : 0,
                  end: last ? last.end + 5 : 5,
                  text: '',
                };
                setPreviewLines([...previewLines, newLine]);
              }}
              className="w-full py-2 text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg hover:border-indigo-400 hover:text-indigo-600 transition-colors cursor-pointer"
            >
              + Add line at end
            </button>

            {/* Confirm / Cancel */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleConfirm}
                className="px-6 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
              >
                Confirm Import ({previewLines.length} lines)
              </button>
              <button
                onClick={handleCancel}
                className="px-4 py-2.5 text-sm text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TranscriptImporter;
