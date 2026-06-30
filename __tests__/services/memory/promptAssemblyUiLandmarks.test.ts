import { assemblePrompt, flattenPromptSections } from '../../../src/services/memory/promptAssembly';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function fact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'ui-landmark',
    subjectId: 'surface:test',
    predicate: 'ui_inventory',
    objectText: '{}',
    objectEntityId: null,
    attributes: {},
    confidence: 0.9,
    sourceMessageId: null,
    sourceRunId: 'run-ui-landmark',
    contentHash: 'hash',
    embedding: null,
    validAt: 1,
    invalidAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    pinned: false,
    memoryKind: 'ui_inventory',
    ...overrides,
  };
}

describe('assemblePrompt — UI landmarks', () => {
  it('renders section landmark roles as first-class compact UI evidence', () => {
    const out = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact({
          objectText: JSON.stringify({
            url: 'https://workflow.example.test/profile/edit',
            sourceRunId: 'run-ui-landmark',
            stateIndex: '5',
            sections: [
              {
                label: 'qprofile-card',
                landmarkRole: 'complementary',
                structuralPath: [{ role: 'complementary' }, { role: 'Section' }],
                controlNames: ['qprofile-link', 'qedit-profile'],
                textSnippets: ['qprofile-text'],
              },
            ],
          }),
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('"landmarkRows"');
    expect(text).toContain('"sectionLabels":["qprofile-card"]');
    expect(text).toContain('"landmarkRole":"complementary"');
    expect(text).toContain('"controlNames":["qprofile-link","qedit-profile"]');
  });
});
