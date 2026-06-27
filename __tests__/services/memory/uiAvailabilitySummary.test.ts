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

  it('summarizes named sections and their controls from recalled inventories', () => {
    const summary = buildUiAvailabilitySummary('Compare links in `qsection-alpha`.', [
      makeInventory({
        sourceRunId: 'current-profile',
        url: 'https://forum.example.test/user/current',
        visibleControls: ['qsection-action-one', 'qsection-action-two'],
        sections: [
          {
            label: 'qsection-alpha',
            controlNames: ['qsection-action-one', 'qsection-action-two'],
          },
        ],
      }),
      makeInventory({
        sourceRunId: 'other-profile',
        url: 'https://forum.example.test/user/other',
        visibleControls: ['qsection-action-three'],
        sections: [
          {
            label: 'qsection-alpha',
            controlNames: ['qsection-action-three'],
          },
        ],
      }),
    ]);

    expect(summary).toContain('namedControl: "qsection-alpha"');
    expect(summary).toContain('"namedSectionPresent":true');
    expect(summary).toContain('qsection-action-one');
    expect(summary).toContain('qsection-action-three');
  });

  it('keeps strong quoted UI labels distinct from apostrophes in adjacent text', () => {
    const summary = buildUiAvailabilitySummary(
      "qactor-one's view compares `qsection-beta` with qactor-two's view.",
      [
        makeInventory({
          sourceRunId: 'first-surface',
          url: 'https://forum.example.test/user/first',
          visibleControls: ['qsection-beta-action-one'],
          sections: [
            {
              label: 'qsection-beta',
              controlNames: ['qsection-beta-action-one'],
            },
          ],
        }),
      ],
    );

    expect(summary).toContain('namedControl: "qsection-beta"');
    expect(summary).toContain('qsection-beta-action-one');
  });
});
