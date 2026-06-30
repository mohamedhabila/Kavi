import { supportPhaseKey } from '../../../src/services/memory/ranking/selection';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function uiInventoryFact(url: string): MemoryFact {
  return {
    id: 'fact-malformed-url',
    subjectId: 'surface',
    predicate: 'ui_inventory',
    objectText: JSON.stringify({ url }),
    attributes: { url },
    sourceRunId: 'run-malformed-url',
    memoryKind: 'ui_inventory',
  } as MemoryFact;
}

describe('memory ranking selection', () => {
  it('keeps malformed percent-encoded surface URLs from aborting support ranking', () => {
    expect(() =>
      supportPhaseKey(uiInventoryFact('https://example.test/form/%E0%A4%A?record=1')),
    ).not.toThrow();
  });
});
