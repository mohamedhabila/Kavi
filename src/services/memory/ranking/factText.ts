import type { MemoryFact } from '../facts/types';
import { compactJsonFields, parseJsonRecord } from '../factJson';
import { retrievalFieldsForMemoryKind } from '../uiFactFields';

export function retrievalObjectTextForFact(fact: MemoryFact): string {
  const fields = retrievalFieldsForMemoryKind(fact.memoryKind);
  if (!fields) return fact.objectText;
  const parsed = parseJsonRecord(fact.objectText);
  return parsed ? compactJsonFields(parsed, fields) : fact.objectText;
}

export function retrievalTextForFact(fact: MemoryFact): string {
  return `${fact.subjectId} ${fact.predicate} ${retrievalObjectTextForFact(fact)} ${
    fact.sourceSummary ?? ''
  }`;
}
