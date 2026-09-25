import { lemmatize } from './lemmatizer';
import type { TranscriptLine } from '../types';

export interface TranscriptWordToken {
  text: string;
  saved: boolean;
}

/** Prepare the transcript's word tokens and saved states when its data changes. */
export function prepareTranscriptWords(
  lines: TranscriptLine[],
  savedWords: Set<string>,
): TranscriptWordToken[][] {
  return lines.map((line) =>
    (line.text.match(/[\w']+|[^\w\s]+|\s+/g) || []).map((text) => ({
      text,
      saved: /^[\w']+$/.test(text) && savedWords.has(lemmatize(text.toLowerCase()).toLowerCase()),
    })),
  );
}
