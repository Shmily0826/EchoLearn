import { describe, expect, it } from 'vitest';
import { parseDictionary } from '../../../scripts/dictionary-evaluation.ts';
import {
  cleanDefinitions,
  cleanTranslations,
  contextLemma,
  evaluateContextRows,
  normalizeLookup,
  parseContextRows,
} from '../../../scripts/dictionary-context-poc.ts';

describe('dictionary context PoC', () => {
  it('normalizes phrases and uses the existing lemmatizer for inflected forms', () => {
    expect(normalizeLookup(' Self–Driving  ')).toBe('self-driving');
    expect(contextLemma('self-driving')).toBe('self-driving');
    expect(contextLemma('studied')).toBe('study');
    expect(contextLemma('make up')).toBe('make up');
  });

  it('cleans POS/domain/form noise without dropping distinct translations', () => {
    expect(cleanDefinitions('n. a river side\\n[finance] a domain note')).toEqual(['a river side', 'a domain note']);
    expect(cleanTranslations('v. manufacture; [finance] cancel; make\u7684\u8fc7\u53bb\u5f0f\u548c\u8fc7\u53bb\u5206\u8bcd')).toEqual(['manufacture', 'cancel']);
  });

  it('retrieves both surface and lemma entries and safely abstains without definition evidence', () => {
    const rows = parseDictionary([
      'word,definition,translation,pos',
      'studied,"a. deliberate",a. cautious,adj',
      'study,"v. applying the mind to learning",v. learn,v',
    ].join('\n'));
    const [result] = evaluateContextRows([{
      category: 'test', target: 'studied', sentence: 'She studied the map.',
    }], rows);
    expect(result.lemmaUsed).toBe('study');
    expect(result.candidates.map((candidate) => `${candidate.source}:${candidate.entry}`)).toEqual(['surface:studied', 'lemma:study']);
    expect(result.selectedSource).toBe('none');
    expect(result.selectedMeaningCn).toBe('');
  });

  it('selects a sole gloss from generic English-definition overlap but abstains for multi-gloss entries', () => {
    const rows = parseDictionary([
      'word,definition,translation',
      'bank,"n. financial institution\\nn. side of a river",n. banking;river-side',
      'nuance,"n. subtle difference in meaning",n. difference',
      'make up,,invent;reconcile',
    ].join('\n'));
    const [positive] = evaluateContextRows([{
      category: 'test', target: 'nuance', sentence: 'The subtle difference matters.',
    }], rows);
    expect(positive.selectedMeaningCn).toBe('difference');
    const [ambiguous] = evaluateContextRows([{
      category: 'test', target: 'bank', sentence: 'The boat reached the river bank.',
    }], rows);
    expect(ambiguous.selectedMeaningCn).toBe('');
    expect(ambiguous.selectedSource).toBe('none');
    const [phrase] = evaluateContextRows([{
      category: 'test', target: 'make up', sentence: 'They made up after the argument.',
    }], rows);
    expect(phrase.selectedMeaningCn).toBe('');
    expect(phrase.reason).toContain('abstained');
    expect(() => parseContextRows('[]')).toThrow('non-empty');
  });
});
