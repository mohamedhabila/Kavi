import { buildUiAvailabilitySummary } from '../../../src/services/memory/uiAvailabilitySummary';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function makeInventory(objectText: Record<string, unknown>): MemoryFact {
  return {
    id: `fact-${String(objectText.sourceRunId ?? 'x')}`,
    subjectId: 'surface:https://forum.example.test',
    predicate: 'ui_inventory',
    objectText: JSON.stringify(objectText),
    objectEntityId: null,
    attributes: {},
    confidence: 0.9,
    sourceMessageId: null,
    sourceRunId: typeof objectText.sourceRunId === 'string' ? objectText.sourceRunId : null,
    contentHash: 'h',
    embedding: null,
    validAt: 1,
    invalidAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    pinned: false,
    memoryKind: 'ui_inventory',
  };
}

describe('buildUiAvailabilitySummary', () => {
  it('summarizes explicit UI labels against recalled visible controls', () => {
    const summary = buildUiAvailabilitySummary(
      'Which states do not have `Mute this forum`? Return `none` if all have it.',
      [
        makeInventory({
          sourceGoal: 'Open forum page',
          sourceRunId: 'forum-run',
          stateIndex: '4',
          url: 'https://forum.example.test/f/general',
          visibleControls: ['Subscribe via RSS', 'Hide this forum', 'Moderation log'],
        }),
      ],
    );

    expect(summary).toContain('namedControl: "Mute this forum"');
    expect(summary).toContain('"namedControlVisible":false');
    expect(summary).toContain('Hide this forum');
    expect(summary).not.toContain('namedControl: "none"');
  });

  it('includes exact single-token UI labels only when observed in controls', () => {
    const summary = buildUiAvailabilitySummary('Tap `Save` after editing.', [
      makeInventory({
        sourceRunId: 'settings-run',
        url: 'https://app.example.test/settings',
        visibleControls: ['Cancel', 'Save'],
      }),
    ]);

    expect(summary).toContain('namedControl: "Save"');
    expect(summary).toContain('"namedControlVisible":true');
  });
});
