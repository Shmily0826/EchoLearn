import { useRef, useState } from 'react';
import type { TranscriptLine } from '../types';
import { LocalAudioError, parseLocalSubtitle, transcribeLocalAudio, validateLocalMediaAudio } from '../services/localAudio';
import { useI18n } from '../i18n/I18nContext';

function isStorageFailure(error: unknown): boolean {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  return (error instanceof LocalAudioError && error.code === 'persistence')
    || ['QuotaExceededError', 'SecurityError', 'InvalidStateError'].includes(name);
}

interface LocalAudioImporterProps {
  onSuccess: (file: File, lines: TranscriptLine[]) => void | Promise<void>;
  mode?: 'legacy-asr' | 'local-media';
  /** 'restore' reattaches the files to the CURRENT lesson instead of creating a new one. */
  variant?: 'import' | 'restore';
}

export default function LocalAudioImporter({ onSuccess, mode = 'legacy-asr', variant = 'import' }: LocalAudioImporterProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [state, setState] = useState<'idle' | 'uploading' | 'transcribing'>('idle');
  const [error, setError] = useState<string | null>(null);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const [mediaState, setMediaState] = useState<'idle' | 'importing'>('idle');
  const subtitleInputRef = useRef<HTMLInputElement>(null);

  if (mode === 'local-media') {
    return (
      <div className="mt-3 rounded-lg border border-indigo-100 dark:border-slate-700 bg-indigo-50/50 dark:bg-slate-800/60 px-3 py-2" data-testid="local-media-importer" data-variant={variant}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={mediaState !== 'idle'} title={t('localMedia.audioRequirements')} className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed">
            {t('localMedia.importAudio')}
          </button>
          <input ref={inputRef} data-testid="local-media-audio-input" type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav" className="hidden" onChange={(event) => { setAudioFile(event.target.files?.[0] ?? null); setError(null); }} />
          <span className="min-w-0 max-w-[14rem] truncate text-xs text-gray-600 dark:text-gray-300">{audioFile?.name || t('localMedia.noAudio')}</span>
          <button type="button" onClick={() => subtitleInputRef.current?.click()} disabled={mediaState !== 'idle'} className="px-3 py-1.5 text-sm rounded-lg border border-indigo-200 dark:border-slate-600 text-indigo-700 dark:text-indigo-300 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed">
            {t('localMedia.chooseSubtitle')}
          </button>
          <input ref={subtitleInputRef} data-testid="local-media-subtitle-input" type="file" accept=".srt,.vtt" className="hidden" onChange={(event) => { setSubtitleFile(event.target.files?.[0] ?? null); setError(null); }} />
          <span className="min-w-0 max-w-[14rem] truncate text-xs text-gray-600 dark:text-gray-300">{subtitleFile?.name || t('localMedia.noSubtitle')}</span>
          <button
            type="button"
            disabled={mediaState !== 'idle' || !audioFile || !subtitleFile}
            onClick={() => { void submitMedia(); }}
            className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {mediaState === 'importing' ? t('localMedia.opening') : variant === 'restore' ? t('study.restoreAudioCta') : t('localMedia.openCta')}
          </button>
        </div>
        {/* The size/no-transcription contract is stated once, before the learner
            has committed to a file; after that the row would only repeat it. */}
        {!audioFile && !subtitleFile && (
          <p className="mt-1.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{t('localMedia.audioRequirements')}</p>
        )}
        {audioFile && !subtitleFile && <p role="status" className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">{t('localMedia.subtitlesRequired')}</p>}
        {variant === 'restore' && <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-300">{t('study.restoreAudioNote')}</p>}
        {error && <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  async function submitMedia() {
    if (mediaState !== 'idle' || !audioFile || !subtitleFile) return;
    setMediaState('importing');
    setError(null);
    try {
      const audioError = validateLocalMediaAudio(audioFile);
      if (audioError) throw audioError;
      const lines = await parseLocalSubtitle(subtitleFile);
      await onSuccess(audioFile, lines);
    } catch (err) {
      setError(isStorageFailure(err) ? t('localMedia.storageFailed') : err instanceof LocalAudioError && err.code === 'too_large' ? t('localMedia.audioTooLarge') : err instanceof LocalAudioError ? err.message : t('localMedia.importFailed'));
    } finally {
      setMediaState('idle');
    }
  }

  // The legacy branch deliberately remains available for existing ASR callers.
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
