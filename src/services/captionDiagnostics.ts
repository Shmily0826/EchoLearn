import type { CaptionDiagnostics, SupadataAttemptOutcome } from '../types';

export const CAPTION_DIAGNOSTICS_STORAGE_KEY = 'echolearn_caption_diagnostics_v1';

export interface CaptionDiagnosticsAggregate {
  version: 1;
  supadataAttempts: number;
  supadataSuccesses: number;
  supadataUnavailable: number;
  supadataTimeouts: number;
  supadataFailures: number;
  /** Estimate only: one likely billable request per observed attempt. */
  estimatedCredits: number;
  updatedAt: number;
}

const OUTCOMES: SupadataAttemptOutcome[] = [
  'not_attempted',
  'success',
  'unavailable',
  'timeout',
  'failure',
];

function emptyAggregate(): CaptionDiagnosticsAggregate {
  return {
    version: 1,
    supadataAttempts: 0,
    supadataSuccesses: 0,
    supadataUnavailable: 0,
    supadataTimeouts: 0,
    supadataFailures: 0,
    estimatedCredits: 0,
    updatedAt: 0,
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function loadCaptionDiagnostics(): CaptionDiagnosticsAggregate {
  const store = storage();
  if (!store) return emptyAggregate();
  try {
    const raw = store.getItem(CAPTION_DIAGNOSTICS_STORAGE_KEY);
    if (!raw) return emptyAggregate();
    const parsed = JSON.parse(raw) as Partial<CaptionDiagnosticsAggregate>;
    return {
      version: 1,
      supadataAttempts: nonnegativeInteger(parsed.supadataAttempts),
      supadataSuccesses: nonnegativeInteger(parsed.supadataSuccesses),
      supadataUnavailable: nonnegativeInteger(parsed.supadataUnavailable),
      supadataTimeouts: nonnegativeInteger(parsed.supadataTimeouts),
      supadataFailures: nonnegativeInteger(parsed.supadataFailures),
      estimatedCredits: nonnegativeInteger(parsed.estimatedCredits),
      updatedAt: nonnegativeInteger(parsed.updatedAt),
    };
  } catch {
    return emptyAggregate();
  }
}

export function normalizeCaptionDiagnostics(value: unknown): CaptionDiagnostics | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as { supadata?: unknown };
  if (!raw.supadata || typeof raw.supadata !== 'object' || Array.isArray(raw.supadata)) return undefined;
  const candidate = raw.supadata as { attempted?: unknown; outcome?: unknown };
  if (typeof candidate.attempted !== 'boolean') return undefined;
  const outcome = OUTCOMES.includes(candidate.outcome as SupadataAttemptOutcome)
    ? candidate.outcome as SupadataAttemptOutcome
    : candidate.attempted ? 'failure' : 'not_attempted';
  return { supadata: { attempted: candidate.attempted, outcome } };
}

/** Preserve an earlier Supadata attempt when a later client path succeeds. */
export function mergeCaptionDiagnostics(
  first?: CaptionDiagnostics,
  second?: CaptionDiagnostics,
): CaptionDiagnostics | undefined {
  const firstSupadata = first?.supadata;
  const secondSupadata = second?.supadata;
  if (firstSupadata?.attempted) return { supadata: firstSupadata };
  if (secondSupadata?.attempted) return { supadata: secondSupadata };
  const fallback = secondSupadata ?? firstSupadata;
  return fallback ? { supadata: fallback } : undefined;
}

/** Record one server-observed Supadata attempt in this browser only. */
export function recordCaptionDiagnostics(
  diagnostics: CaptionDiagnostics | undefined,
  now = Date.now(),
): CaptionDiagnosticsAggregate {
  const current = loadCaptionDiagnostics();
  const supadata = diagnostics?.supadata;
  if (!supadata?.attempted) return current;

  const next = {
    ...current,
    supadataAttempts: current.supadataAttempts + 1,
    estimatedCredits: current.estimatedCredits + 1,
    updatedAt: now,
  };
  if (supadata.outcome === 'success') next.supadataSuccesses += 1;
  else if (supadata.outcome === 'unavailable') next.supadataUnavailable += 1;
  else if (supadata.outcome === 'timeout') next.supadataTimeouts += 1;
  else next.supadataFailures += 1;

  const store = storage();
  if (store) {
    try {
      store.setItem(CAPTION_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Diagnostics must never break caption acquisition when storage is full.
    }
  }
  return next;
}
