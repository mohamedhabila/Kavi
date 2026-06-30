import { buildUiActionResultMemory } from '../../../src/services/memory/uiActionResultMemory';

describe('buildUiActionResultMemory', () => {
  it('keeps transition fields and prioritized UI action evidence under budget', () => {
    const payload = buildUiActionResultMemory({
      action: "click('qtarget-node')",
      thought: 'qcurrent-transition-thought',
      goal: 'qgoal-text',
      trajectoryOutcome: 'success',
      url: 'https://workflow.example.test/current',
      sourceRunId: 'run-action-result-priority',
      stateIndex: '8',
      previousAction: "fill('qprevious-node', 'qprevious-value')",
      previousThought: 'qprevious-transition-thought',
      previousStateIndex: '7',
      recentActionTrail: [
        ...Array.from({ length: 7 }, (_, index) => ({
          stateIndex: String(index),
          action: `tap('qtrail-${index}')`,
          thought: `qtrail-thought-${index}`,
        })),
        {
          stateIndex: '7',
          action: "fill('qprevious-node', 'qprevious-value')",
          thought: `${'qmiddle-padding '.repeat(30)}qprevious-transition-tail`,
        },
      ],
      maxTextChars: 4000,
      inventoryPayload: {
        surfaceLabels: ['qsurface'],
        visibleTextSnippets: [
          {
            index: 4,
            text: `qvisible-prefix ${'qpadding '.repeat(36)}qvisible-tail-target`,
            contextLabels: ['qsurface'],
          },
        ],
        fieldLabels: Array.from({ length: 40 }, (_, index) => `qfield-${index}`),
        fields: Array.from({ length: 40 }, (_, index) => ({
          label: `qfield-${index}`,
          role: 'textbox',
          value: `qvalue-${index}`,
        })),
        actionControls: [
          ...Array.from({ length: 40 }, (_, index) => ({
            index,
            nodeId: `qchrome-${index}`,
            role: 'button',
            name: `qchrome-control-${index}`,
          })),
          {
            index: 99,
            nodeId: 'qtarget-node',
            role: 'button',
            name: 'qtarget-control',
          },
        ],
        controlNames: [
          ...Array.from({ length: 30 }, (_, index) => `qchrome-name-${index}`),
          'qtarget-control-name',
        ],
      },
    });

    expect(payload).not.toBeNull();
    expect(payload!.objectText.length).toBeLessThanOrEqual(4000);
    const parsed = JSON.parse(payload!.objectText);

    expect(parsed).toMatchObject({
      action: "click('qtarget-node')",
      thought: 'qcurrent-transition-thought',
      previousAction: "fill('qprevious-node', 'qprevious-value')",
      previousThought: 'qprevious-transition-thought',
      stateIndex: '8',
      previousStateIndex: '7',
    });
    expect(JSON.stringify(parsed.visibleTextSnippets)).toContain('qvisible-tail-target');
    expect(parsed.actionControls[0]).toMatchObject({
      nodeId: 'qtarget-node',
      name: 'qtarget-control',
    });
    expect(parsed.recentActionTrail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stateIndex: '7',
          action: "fill('qprevious-node', 'qprevious-value')",
        }),
      ]),
    );
    expect(JSON.stringify(parsed.recentActionTrail)).toContain('qprevious-transition-tail');
    expect(parsed.controlNames).toContain('qtarget-control-name');
    expect(payload!.objectText.indexOf('qcurrent-transition-thought')).toBeLessThan(
      payload!.objectText.indexOf('recentActionTrail'),
    );
  });
});
