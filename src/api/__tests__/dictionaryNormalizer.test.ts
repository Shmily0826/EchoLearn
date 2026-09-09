import { describe, expect, it } from 'vitest';
import { normalizeSourceDefinition } from '../../../api/dictionary';

describe('normalizeSourceDefinition', () => {
  it('compacts the reproduced Datamuse Stratford list before translation', () => {
    const source = 'The name of various cities, towns and boroughs in the USA, United Kingdom, Canada, Australia and New Zealand. See the full list.';

    expect(normalizeSourceDefinition(source)).toBe(
      'The name of various cities, towns and boroughs in the USA, United Kingdom, Canada, etc.',
    );
  });

  it('removes the reproduced Merriam-Webster anniversary usage tail', () => {
    const source = 'a date that is remembered or celebrated because a special or notable event occurred on that date in a previous year —often used before another noun';

    expect(normalizeSourceDefinition(source)).toBe(
      'a date that is remembered or celebrated because a special or notable event occurred on that date in a previous year',
    );
  });

  it('leaves unmarked lists and non-tail usage wording unchanged', () => {
    const list = 'A place in Canada, Australia and New Zealand.';
    const usage = 'Usually used before another noun in this specific sense.';

    expect(normalizeSourceDefinition(list)).toBe(list);
    expect(normalizeSourceDefinition(usage)).toBe(usage);
  });
});
