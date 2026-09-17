import { CF_WORKER_URL } from './youtubeTranscript';

export const LOCAL_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const AUDIO_TYPES: Record<string, Set<string>> = {
  mp3: new Set(['audio/mpeg', 'audio/mp3']),
  m4a: new Set(['audio/mp4', 'audio/x-m4a']),
  wav: new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
};

export type LocalAudioErrorCode = 'unsupported' | 'too_large' | 'upload' | 'timeout' | 'transcription' | 'no_speech' | 'invalid_audio';

export class LocalAudioError extends Error {
  code: LocalAudioErrorCode;
  constructor(code: LocalAudioErrorCode, message: string) {
    super(message);
    this.name = 'LocalAudioError';
    this.code = code;
  }
}

export function validateLocalAudio(file: File): LocalAudioError | null {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!AUDIO_TYPES[extension] || !AUDIO_TYPES[extension].has((file.type || '').toLowerCase())) {
    return new LocalAudioError('unsupported', 'Use an mp3, m4a, or wav audio file.');
  }
  if (file.size > LOCAL_AUDIO_MAX_BYTES) {
    return new LocalAudioError('too_large', 'Audio files must be 25 MiB or smaller.');
  }
  return null;
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

export function registerLocalAudio(id: string, file: File): string {
  const previous = localAudioFiles.get(id);
  if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(file);
  localAudioFiles.set(id, url);
  return url;
}

export function getLocalAudioUrl(id: string): string | null {
  return localAudioFiles.get(id) ?? null;
}
