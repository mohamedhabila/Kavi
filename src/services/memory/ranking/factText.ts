import type { MemoryFact } from '../facts/types';

export function retrievalObjectTextForFact(fact: MemoryFact): string {
  return fact.objectText;
}

export function retrievalTextForFact(fact: MemoryFact): string {
  return `${fact.subjectId} ${fact.predicate} ${retrievalObjectTextForFact(fact)} ${
    fact.sourceSummary ?? ''
  }`;
}
