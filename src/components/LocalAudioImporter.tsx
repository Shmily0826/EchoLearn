import { useRef, useState } from 'react';
import type { TranscriptLine } from '../types';
import { LocalAudioError, transcribeLocalAudio } from '../services/localAudio';

interface LocalAudioImporterProps {
  onSuccess: (file: File, lines: TranscriptLine[]) => void;
}

export default function LocalAudioImporter({ onSuccess }: LocalAudioImporterProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [state, setState] = useState<'idle' | 'uploading' | 'transcribing'>('idle');
  const [error, setError] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file || state !== 'idle') return;
    setFileName(file.name);
    setError(null);
    setState('uploading');
    try {
      const result = await transcribeLocalAudio(file, undefined, () => setState('transcribing'));
      onSuccess(file, result.lines);
      setState('idle');
    } catch (err) {
      setState('idle');
      setError(err instanceof LocalAudioError ? err.message : 'Audio transcription failed.');
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-indigo-100 dark:border-slate-700 bg-indigo-50/50 dark:bg-slate-800/60 p-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={state !== 'idle'} className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed">
          Import Audio
        </button>
        <input ref={inputRef} type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav" className="hidden" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
        {fileName && <span className="min-w-0 truncate text-xs text-gray-600 dark:text-gray-300">{fileName}</span>}
      </div>
      {state !== 'idle' && <p className="mt-2 text-xs text-indigo-600 dark:text-indigo-300">{state === 'uploading' ? 'Uploading…' : 'Transcribing…'}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
