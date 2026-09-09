import type { VocabularyItem } from '../types';
import { loadVocabulary } from '../utils/storage';

const MAX_SAMPLES = 5;
const MAX_GROUPS = 5;
const MAX_GROUP_ITEMS = 10;

export type VocabularyMeaningClass =
  | 'blank'
  | 'local-no-translation-placeholder'
  | 'han'
  | 'likely-non-chinese-latin'
  | 'other-non-han';

export interface VocabularyDiagnosticSample {
  id: string;
  word: string;
}

export interface VocabularyDiagnosticGroup {
  normalizedKey: string;
  items: VocabularyDiagnosticSample[];
}

export interface VocabularyDiagnosticsReport {
  totalItems: number;
  meaningCn: {
    blank: number;
    localNoTranslationPlaceholders: number;
    hanCharacters: number;
    likelyNonChineseLatin: number;
    likelyNonChineseBasis: 'heuristic: Latin letters present and no Han characters; not proof of English';
    otherNonHan: number;
    samples: Partial<Record<VocabularyMeaningClass, VocabularyDiagnosticSample[]>>;
  };
  surfaceDuplicates: {
    groupCount: number;
    excessItems: number;
    groups: VocabularyDiagnosticGroup[];
  };
  persistedLemma: {
    itemCount: number;
    provenance: 'unavailable/unverifiable when not persisted on VocabularyItem';
    samples: VocabularyDiagnosticSample[];
  };
  lemmaSurfaceCollisions: {
    groupCount: number;
    excessItems: number;
    groups: VocabularyDiagnosticGroup[];
  };
  dictionaryProviders: {
    byProvider: Record<string, number>;
    missing: number;
  };
}

const HAS_HAN = /\p{Script=Han}/u;
const HAS_LATIN = /[A-Za-z]/;
const LOCAL_NO_TRANSLATION = new Set([
  '(Local analysis — no translation)',
  '(本地分析 — 无翻译)',
]);

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

function sample(item: VocabularyItem): VocabularyDiagnosticSample {
  return { id: item.id, word: item.word };
}

function boundedSamples(items: VocabularyItem[]): VocabularyDiagnosticSample[] {
  return items.slice(0, MAX_SAMPLES).map(sample);
}

function groupsFromMap(map: Map<string, VocabularyItem[]>): VocabularyDiagnosticGroup[] {
  return [...map.entries()]
    .filter(([, items]) => items.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_GROUPS)
    .map(([normalizedKey, items]) => ({
      normalizedKey,
      items: items.slice(0, MAX_GROUP_ITEMS).map(sample),
    }));
}

function groupExcess(map: Map<string, VocabularyItem[]>): number {
  return [...map.values()]
    .filter((items) => items.length > 1)
    .reduce((total, items) => total + items.length - 1, 0);
}

function classifyMeaning(value: string): VocabularyMeaningClass {
  const meaning = value.trim();
  if (!meaning) return 'blank';
  if (LOCAL_NO_TRANSLATION.has(meaning)) return 'local-no-translation-placeholder';
  if (HAS_HAN.test(meaning)) return 'han';
  if (HAS_LATIN.test(meaning)) return 'likely-non-chinese-latin';
  return 'other-non-han';
}

export function analyzeVocabulary(items: VocabularyItem[]): VocabularyDiagnosticsReport {
  const meaningCounts: Record<VocabularyMeaningClass, number> = {
    blank: 0,
    'local-no-translation-placeholder': 0,
    han: 0,
    'likely-non-chinese-latin': 0,
    'other-non-han': 0,
  };
  const meaningSamples: Partial<Record<VocabularyMeaningClass, VocabularyDiagnosticSample[]>> = {};
  const surfaceMap = new Map<string, VocabularyItem[]>();
  const canonicalMap = new Map<string, VocabularyItem[]>();
  const providerCounts: Record<string, number> = {};
  let missingProvider = 0;
  let localNoTranslationPlaceholders = 0;
  const lemmaItems: VocabularyItem[] = [];

  for (const item of items) {
    const meaningClass = classifyMeaning(item.meaningCn);
    meaningCounts[meaningClass] += 1;
    if (!meaningSamples[meaningClass]) meaningSamples[meaningClass] = [];
    if (meaningSamples[meaningClass]!.length < MAX_SAMPLES) meaningSamples[meaningClass]!.push(sample(item));
    if (meaningClass === 'local-no-translation-placeholder') localNoTranslationPlaceholders += 1;

    const surfaceKey = normalized(item.word);
    if (surfaceKey) surfaceMap.set(surfaceKey, [...(surfaceMap.get(surfaceKey) ?? []), item]);

    const lemma = normalized(item.lemma);
    if (lemma) {
      lemmaItems.push(item);
      canonicalMap.set(lemma, [...(canonicalMap.get(lemma) ?? []), item]);
    } else if (surfaceKey) {
      canonicalMap.set(surfaceKey, [...(canonicalMap.get(surfaceKey) ?? []), item]);
    }

    const provider = item.dictionaryProvider?.trim();
    if (provider) providerCounts[provider] = (providerCounts[provider] ?? 0) + 1;
    else missingProvider += 1;
  }

  const collisionMap = new Map(
    [...canonicalMap.entries()].filter(([, grouped]) =>
      new Set(grouped.map((item) => normalized(item.word))).size > 1
      && grouped.some((item) => normalized(item.lemma)),
    ),
  );

  return {
    totalItems: items.length,
    meaningCn: {
      blank: meaningCounts.blank,
      localNoTranslationPlaceholders,
      hanCharacters: meaningCounts.han,
      likelyNonChineseLatin: meaningCounts['likely-non-chinese-latin'],
      likelyNonChineseBasis: 'heuristic: Latin letters present and no Han characters; not proof of English',
      otherNonHan: meaningCounts['other-non-han'],
      samples: meaningSamples,
    },
    surfaceDuplicates: {
      groupCount: [...surfaceMap.values()].filter((group) => group.length > 1).length,
      excessItems: groupExcess(surfaceMap),
      groups: groupsFromMap(surfaceMap),
    },
    persistedLemma: {
      itemCount: lemmaItems.length,
      provenance: 'unavailable/unverifiable when not persisted on VocabularyItem',
      samples: boundedSamples(lemmaItems),
    },
    lemmaSurfaceCollisions: {
      groupCount: [...collisionMap.values()].filter((group) => group.length > 1).length,
      excessItems: groupExcess(collisionMap),
      groups: groupsFromMap(collisionMap),
    },
    dictionaryProviders: {
      byProvider: providerCounts,
      missing: missingProvider,
    },
  };
}

/** Read-only diagnostic access over the application's parsed local Vocabulary data. */
export function readVocabularyDiagnostics(): VocabularyDiagnosticsReport {
  return analyzeVocabulary(loadVocabulary());
}

/** Read-only serialized diagnostic access for console/dev tooling. */
export function serializeVocabularyDiagnostics(): string {
  return JSON.stringify(readVocabularyDiagnostics());
}
