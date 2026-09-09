import { describe, expect, it } from 'vitest';
import { normalizeSourceDefinition } from '../../../api/dictionary';

describe('normalizeSourceDefinition', () => {
  it('compacts the reproduced Datamuse Stratford list before translation', () => {
    const source = 'The name of various cities, towns and boroughs in the USA, United Kingdom, Canada, Australia and New Zealand. See the full list.';

    expect(normalizeSourceDefinition(source)).toBe(
      'The name of various cities, towns and boroughs in the USA, United Kingdom, Canada, etc.',
    );
  });

  it.each([
    ['often', 'a date that is remembered or celebrated —often used before another noun', 'a date that is remembered or celebrated'],
    ['usually', 'a word —usually used in formal writing', 'a word'],
    ['sometimes', 'a word —sometimes used as a noun', 'a word'],
  ])('removes bounded %s usage-note tails', (_label, source, expected) => {
    expect(normalizeSourceDefinition(source)).toBe(expected);
  });

  it.each([
    ['See also', 'A related meaning. See also the entry for example.', 'A related meaning'],
    ['See the entry', 'A related meaning. See the entry for example.', 'A related meaning'],
    ['Compare', 'A related meaning; Compare the entry for example.', 'A related meaning'],
    ['More at', 'A related meaning — More at the provider site.', 'A related meaning'],
  ])('removes bounded %s editorial pointers', (_label, source, expected) => {
    expect(normalizeSourceDefinition(source)).toBe(expected);
  });

  it('leaves unmarked lists and non-tail usage wording unchanged', () => {
    const list = 'A place in Canada, Australia and New Zealand.';
    const usage = 'This tool is often used in schools and libraries.';
    const comparison = 'You can compare these values to find a match.';

    expect(normalizeSourceDefinition(list)).toBe(list);
    expect(normalizeSourceDefinition(usage)).toBe(usage);
    expect(normalizeSourceDefinition(comparison)).toBe(comparison);
  });
});
