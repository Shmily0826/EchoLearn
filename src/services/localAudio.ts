import { CF_WORKER_URL } from './youtubeTranscript';
import type { TranscriptLine } from '../types';
import { parseSrtTranscript, parseVttTranscript } from '../utils/transcriptParser';

export const LOCAL_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const LOCAL_MEDIA_MAX_BYTES = 200 * 1024 * 1024;
const AUDIO_TYPES: Record<string, Set<string>> = {
  mp3: new Set(['audio/mpeg', 'audio/mp3']),
  m4a: new Set(['audio/mp4', 'audio/x-m4a']),
  wav: new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
};

export type LocalAudioErrorCode = 'unsupported' | 'too_large' | 'upload' | 'timeout' | 'transcription' | 'no_speech' | 'invalid_audio' | 'unsupported_subtitle' | 'invalid_subtitle' | 'persistence';

export class LocalAudioError extends Error {
  code: LocalAudioErrorCode;
  constructor(code: LocalAudioErrorCode, message: string) {
    super(message);
    this.name = 'LocalAudioError';
    this.code = code;
  }
}

function validateAudio(file: File, maxBytes: number, sizeMessage: string): LocalAudioError | null {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!AUDIO_TYPES[extension] || !AUDIO_TYPES[extension].has((file.type || '').toLowerCase())) {
    return new LocalAudioError('unsupported', 'Use an mp3, m4a, or wav audio file.');
  }
  if (file.size > maxBytes) {
    return new LocalAudioError('too_large', sizeMessage);
  }
  return null;
}

/** Legacy upload/ASR limit. Keep this narrow because the Worker still caps it. */
export function validateLocalAudio(file: File): LocalAudioError | null {
  return validateAudio(file, LOCAL_AUDIO_MAX_BYTES, 'Audio files must be 25 MiB or smaller.');
}

/** Browser-local V2 limit; this path does not upload or transcribe the audio. */
export function validateLocalMediaAudio(file: File): LocalAudioError | null {
  return validateAudio(file, LOCAL_MEDIA_MAX_BYTES, 'Local media audio files must be 200 MiB or smaller.');
}

export interface LocalAudioTranscript {
  lines: Array<{ id?: string; start: number; end: number; text: string }>;
  language?: string;
  source?: string;
}

export function transcribeLocalAudio(
  file: File,
  onUploadProgress?: (percent: number) => void,
  onUploadComplete?: () => void,
): Promise<LocalAudioTranscript> {
  const validationError = validateLocalAudio(file);
  if (validationError) return Promise.reject(validationError);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${CF_WORKER_URL}/api/audio-transcribe`);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onUploadProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.upload.onload = () => onUploadComplete?.();
    xhr.onerror = () => reject(new LocalAudioError('upload', 'Audio upload failed.'));
    xhr.ontimeout = () => reject(new LocalAudioError('timeout', 'Audio transcription timed out.'));
    xhr.onload = () => {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch { /* handled below */ }
      if (xhr.status < 200 || xhr.status >= 300) {
        const code = payload.error;
        const mapped: LocalAudioErrorCode = code === 'audio_too_large' ? 'too_large' : code === 'no_speech' ? 'no_speech' : code === 'invalid_audio' ? 'invalid_audio' : code === 'timeout' ? 'timeout' : 'transcription';
        reject(new LocalAudioError(mapped, typeof payload.message === 'string' ? payload.message : 'Audio transcription failed.'));
        return;
      }
      if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
        reject(new LocalAudioError('no_speech', 'No speech was found in this audio.'));
        return;
      }
      resolve(payload as unknown as LocalAudioTranscript);
    };
    const body = new FormData();
    body.append('file', file, file.name);
    xhr.send(body);
  });
}

const localAudioFiles = new Map<string, string>();

export function registerLocalAudio(id: string, file: Blob): string {
  const previous = localAudioFiles.get(id);
  if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(file);
  localAudioFiles.set(id, url);
  return url;
}

export function getLocalAudioUrl(id: string): string | null {
  return localAudioFiles.get(id) ?? null;
}

const LOCAL_MEDIA_DB = 'echolearn-local-media-v2';
const LOCAL_MEDIA_STORE = 'media';

interface LocalMediaRecord {
  id: string;
  blob: Blob;
  name: string;
  type: string;
}

function openLocalMediaDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new LocalAudioError('persistence', 'This browser cannot persist local audio.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_MEDIA_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LOCAL_MEDIA_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new LocalAudioError('persistence', 'Could not save local audio in this browser.'));
  });
}

function runMediaRequest<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
  return openLocalMediaDb().then((db) => new Promise<T>((resolve, reject) => {
    const persistenceError = (cause?: unknown) => {
      const name = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name) : '';
      return new LocalAudioError(
        'persistence',
        name === 'QuotaExceededError'
          ? 'Not enough browser storage for this audio. Free up space or compress the audio and try again.'
          : 'Could not update local audio storage.',
      );
    };
    try {
      const transaction = db.transaction(LOCAL_MEDIA_STORE, mode);
      transaction.onerror = () => {
        db.close();
        reject(persistenceError(transaction.error));
      };
      action(transaction.objectStore(LOCAL_MEDIA_STORE), resolve, (reason) => reject(persistenceError(reason)));
      transaction.oncomplete = () => db.close();
    } catch (error) {
      db.close();
      reject(persistenceError(error));
    }
  }));
}

/** Parse only the subtitle formats supported by the V2 local-media flow. */
export async function parseLocalSubtitle(file: File): Promise<TranscriptLine[]> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (extension !== 'srt' && extension !== 'vtt') {
    throw new LocalAudioError('unsupported_subtitle', 'Choose an SRT or VTT subtitle file.');
  }
  const text = await file.text();
  const trimmed = text.trim();
  if (!trimmed || !trimmed.includes('-->') || (extension === 'vtt' && !/^WEBVTT(?:\s|$)/i.test(trimmed))) {
    throw new LocalAudioError('invalid_subtitle', 'This subtitle file is malformed or has no timed lines.');
  }
  const lines = extension === 'vtt' ? parseVttTranscript(trimmed) : parseSrtTranscript(trimmed);
  if (!lines.length || lines.some((line) => !Number.isFinite(line.start) || !Number.isFinite(line.end) || line.end <= line.start || !line.text.trim())) {
    throw new LocalAudioError('invalid_subtitle', 'This subtitle file is malformed or has no timed lines.');
  }
  return lines;
}

/** Persist a V2 audio Blob without putting binary data in localStorage. */
export function saveLocalAudioMedia(id: string, file: File): Promise<void> {
  const validationError = validateLocalMediaAudio(file);
  if (validationError) return Promise.reject(validationError);
  return runMediaRequest<void>('readwrite', (store, resolve, reject) => {
    const request = store.put({ id, blob: file, name: file.name, type: file.type } satisfies LocalMediaRecord);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** Restore a persisted V2 audio Blob into the existing object-URL player path. */
export function restoreLocalAudioMedia(id: string): Promise<string | null> {
  return runMediaRequest<LocalMediaRecord | undefined>('readonly', (store, resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result as LocalMediaRecord | undefined);
    request.onerror = () => reject(new LocalAudioError('persistence', 'Could not restore local audio.'));
  }).then((record) => record?.blob ? registerLocalAudio(id, record.blob) : null);
}

/** Remove one persisted local-media item when its Study session is cleared. */
export function deleteLocalAudioMedia(id: string): Promise<void> {
  return runMediaRequest<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new LocalAudioError('persistence', 'Could not clear local audio storage.'));
  });
}

/**
 * Remove every persisted local-media Blob by dropping the database itself.
 *
 * Used by account deletion, whose promise covers all of this device's learning
 * data: deleting records one by one cannot reach Blobs whose session id was
 * already lost. Rejects rather than reporting success when the browser refuses
 * to delete the database, so the caller can say so honestly.
 */
export function deleteAllLocalAudioMedia(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  localAudioFiles.clear();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_MEDIA_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new LocalAudioError('persistence', 'Could not clear local audio storage.'));
    request.onblocked = () => reject(new LocalAudioError('persistence', 'Local audio storage is still open; reload and try again.'));
  });
}
