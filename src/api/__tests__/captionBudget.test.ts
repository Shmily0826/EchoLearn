import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const handlerSource = readFileSync(fileURLToPath(new URL('../../../api/transcript.ts', import.meta.url)), 'utf8');
const clientSource = readFileSync(fileURLToPath(new URL('../../services/youtubeTranscript.ts', import.meta.url)), 'utf8');
const vercel = JSON.parse(readFileSync(fileURLToPath(new URL('../../../vercel.json', import.meta.url)), 'utf8')) as {
  functions: Record<string, { maxDuration: number }>;
};

function timeoutValue(source: string, constant: string): number {
  const match = source.match(new RegExp(`const ${constant} = ([\\d_]+);`));
  if (!match) throw new Error(`Missing timeout constant: ${constant}`);
  return Number(match[1].replaceAll('_', ''));
}

describe('caption budget contract', () => {
  it('pins current server, client, provider, and platform budgets', () => {
    const serverDeadline = timeoutValue(handlerSource, 'TRANSCRIPT_DEADLINE_MS');
    const clientTimeout = timeoutValue(clientSource, 'VERCEL_TIMEOUT_MS');
    const platformCeiling = vercel.functions['api/transcript.ts'].maxDuration * 1000;

    expect(serverDeadline).toBe(21_000);
    expect(clientTimeout).toBe(22_000);
    expect(platformCeiling).toBe(30_000);
    expect(timeoutValue(handlerSource, 'VPS_TIMEOUT_MS')).toBe(1_000);
    expect(timeoutValue(handlerSource, 'SUPADATA_TIMEOUT_MS')).toBe(18_000);
    expect(timeoutValue(handlerSource, 'NPM_FALLBACK_TIMEOUT_MS')).toBe(6_500);
    expect(clientTimeout).toBeGreaterThan(serverDeadline);
    expect(clientTimeout).toBeLessThan(platformCeiling);
  });

  it('keeps every sequential provider timeout clamped to remaining handler time', () => {
    expect(handlerSource).toMatch(/Math\.min\(VPS_TIMEOUT_MS,\s*remainingTranscriptBudget\(deadlineAt\)\)/);
    expect(handlerSource).toMatch(/Math\.min\(SUPADATA_TIMEOUT_MS,\s*remainingMs\)/);
    expect(handlerSource).toMatch(/Math\.min\(NPM_FALLBACK_TIMEOUT_MS,\s*remainingTranscriptBudget\(deadlineAt\)\)/);
  });
});
