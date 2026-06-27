import type { MemoryFact } from '../facts/types';

export function factSemanticKey(fact: MemoryFact): string {
  if (fact.memoryKind === 'ui_inventory') {
    try {
      const parsed = JSON.parse(fact.objectText) as unknown;
      const payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
      const url = typeof fact.attributes.url === 'string' ? fact.attributes.url : '';
      const controlNames = Array.isArray(payload.controlNames)
        ? payload.controlNames.filter((entry): entry is string => typeof entry === 'string').join('\u0001')
        : '';
      const fieldLabels = Array.isArray(payload.fieldLabels)
        ? payload.fieldLabels.filter((entry): entry is string => typeof entry === 'string').join('\u0001')
        : '';
      const sections = Array.isArray(payload.sections) ? JSON.stringify(payload.sections) : '';
      if (url || controlNames || fieldLabels || sections) {
        return [
          fact.subjectId,
          fact.predicate.normalize('NFKC').toLocaleLowerCase().trim(),
          url.normalize('NFKC').toLocaleLowerCase().trim(),
          controlNames.normalize('NFKC').toLocaleLowerCase().trim(),
          fieldLabels.normalize('NFKC').toLocaleLowerCase().trim(),
          sections.normalize('NFKC').toLocaleLowerCase().trim(),
        ].join('\u0000');
      }
    } catch {
      // Fall through to the exact text key for malformed rows.
    }
  }
  return [
    fact.subjectId,
    fact.predicate.normalize('NFKC').toLocaleLowerCase().trim(),
    fact.objectText.normalize('NFKC').toLocaleLowerCase().trim(),
  ].join('\u0000');
}
