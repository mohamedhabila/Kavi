import { assemblePrompt, type PromptMemoryFact } from '../../../src/services/memory/promptAssembly';
import type { MemoryFactKind } from '../../../src/services/memory/facts/types';

function fact(id: string, memoryKind: MemoryFactKind, objectText: string): PromptMemoryFact {
  return {
    id,
    subjectId: `subject-${id}`,
    predicate: memoryKind === 'procedure' ? 'procedure_trace' : 'ui_inventory',
    objectText,
    objectEntityId: null,
    attributes: {},
    confidence: 0.9,
    sourceMessageId: null,
    sourceRunId: `run-${id}`,
    scope: 'conversation',
    originConversationId: 'conv',
    originThreadId: 'conv',
    originTaskId: null,
    sourceTurnId: null,
    sourceSummary: null,
    importance: 0.7,
    accessCount: 0,
    repeatedMentionCount: 0,
    lastRecalledAt: null,
    lastReinforcedAt: null,
    lastAccessedAt: null,
    decayPolicy: 'normal',
    expiresAt: null,
    contentHash: id,
    embedding: null,
    validAt: 1,
    invalidAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    pinned: false,
    sourceActorId: null,
    taskId: null,
    retrievability: 1,
    stability: 1,
    decayRate: 0.01,
    lastPresentedAt: null,
    lastConfirmedAt: null,
    lastConflictedAt: null,
    reviewState: 'auto',
    sensitivity: 'normal',
    memoryKind,
  };
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('assemblePrompt memory ordering', () => {
  it('renders observed UI snapshots before procedural action memory', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'ui',
          'ui_inventory',
          JSON.stringify({
            actionControls: [{ role: 'button', name: 'raw-action' }],
          }),
        ),
        fact(
          'procedure',
          'procedure',
          JSON.stringify({
            steps: [{ action: "click('raw-action')", thought: 'Open the action editor.' }],
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText.indexOf('#### Observed UI and Surface Schema')).toBeLessThan(
      promptText.indexOf('#### Procedures'),
    );
    expect(promptText).toContain('Treat successful traces as stronger action guidance');
    expect(promptText).toContain('observed evidence for a specific URL/state');
    expect(promptText).toContain('unmatched quoted spans may be values, IDs, names, or content');
    expect(promptText).toContain('Count ordinals only within the requested role/context');
  });

  it('renders each memory group note once even when facts split across sections', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: Array.from({ length: 4 }, (_, index) =>
        fact(
          `outcome-split-${index}`,
          'outcome',
          JSON.stringify({
            action: `tap('qaction-${index}')`,
            resultingObservation: {
              visibleTextSnippets: [`qresult-${index}`, `qdetail-${index} ${'x'.repeat(1900)}`],
            },
          }),
        ),
      ),
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(countOccurrences(promptText, '#### Outcomes and Gotchas')).toBeGreaterThan(1);
    expect(countOccurrences(promptText, 'Action-result memories may include')).toBe(1);
    expect(promptText).toContain('qresult-0');
    expect(promptText).toContain('qresult-3');
  });

  it('renders workflow procedures before low-level action outcomes', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'procedure',
          'procedure',
          JSON.stringify({
            steps: [{ action: "tap('qstart')", thought: 'qprocedure-step' }],
          }),
        ),
        fact(
          'action-outcome',
          'outcome',
          JSON.stringify({
            action: "tap('qfinish')",
            thought: 'qoutcome-detail',
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText.indexOf('#### Procedures')).toBeLessThan(
      promptText.indexOf('#### Outcomes and Gotchas'),
    );
    expect(promptText).toContain('qprocedure-step');
    expect(promptText).toContain('qoutcome-detail');
  });

  it('keeps late workflow phases visible in compact procedure traces', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'procedure-compact',
          'procedure',
          JSON.stringify({
            sourceRunId: 'run-procedure-compact',
            goal: 'complete a mobile checkout flow',
            trajectoryOutcome: 'success',
            stepCount: 18,
            steps: Array.from({ length: 18 }, (_, index) => ({
              stateIndex: String(index),
              url: `https://mobile.example.test/flow/${index}`,
              thought:
                index === 15
                  ? 'qlate-phase-marker payment review screen is visible'
                  : `long intermediate thought ${index} ${'x'.repeat(240)}`,
            })),
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('qlate-phase-marker');
    expect(promptText).toContain('"stateIndex":"17"');
    expect(promptText.length).toBeLessThan(6_600);
  });

  it('preserves tail labels inside compact procedure step thoughts', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'procedure-step-tail',
          'procedure',
          JSON.stringify({
            sourceRunId: 'run-procedure-step-tail',
            goal: 'continue a compact workflow',
            trajectoryOutcome: 'success',
            stepCount: 2,
            steps: [
              {
                stateIndex: '1',
                url: 'https://mobile.example.test/flow',
                thought: `${'qverbose '.repeat(40)} qtail-stage-label`,
              },
            ],
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('qtail-stage-label');
  });

  it('renders a compact procedure surface trail before verbose transitions and steps', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'procedure-surface-trail',
          'procedure',
          JSON.stringify({
            sourceRunId: 'run-procedure-surface-trail',
            goal: 'complete a long mobile workflow',
            trajectoryOutcome: 'failure',
            stepCount: 40,
            steps: Array.from({ length: 40 }, (_, index) => ({
              stateIndex: String(index),
              url:
                index === 0
                  ? 'https://mobile.example.test/account'
                  : index === 1
                    ? 'https://mobile.example.test/account/summary'
                    : `https://mobile.example.test/detail/${index}`,
              action: `tap('${index}')`,
              thought: `verbose step detail ${index} ${'x'.repeat(260)}`,
            })),
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('"surfaceTrail"');
    expect(promptText).toContain('"actionTransitions"');
    expect(promptText).toContain('"fromStateIndex":"0"');
    expect(promptText).toContain('"observedAction":"tap(\'1\')"');
    expect(promptText).toContain('"toStateIndex":"1"');
    expect(promptText).toContain('"toUrl":"https://mobile.example.test/account/summary"');
    expect(promptText).toContain('"url":"https://mobile.example.test/account/summary"');
    expect(promptText.indexOf('"surfaceTrail"')).toBeLessThan(
      promptText.indexOf('"actionTransitions"'),
    );
    expect(promptText.indexOf('"actionTransitions"')).toBeLessThan(promptText.indexOf('"steps"'));
  });

  it('keeps procedure surface labels visible before verbose transition history consumes budget', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'procedure-surface-budget',
          'procedure',
          JSON.stringify({
            sourceRunId: 'run-procedure-surface-budget',
            goal: 'complete a long mobile workflow',
            trajectoryOutcome: 'success',
            stepCount: 24,
            steps: Array.from({ length: 24 }, (_, index) => ({
              stateIndex: String(index),
              url: 'https://mobile.example.test/surface',
              action: `tap('${index}')`,
              thought: `qverbose-detail-${index} ${'x'.repeat(260)}`,
              surfaceLabels:
                index < 8
                  ? ['qsurface-start']
                  : index < 16
                    ? ['qsurface-label-retained']
                    : ['qsurface-end'],
            })),
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('qsurface-label-retained');
    expect(promptText.indexOf('qsurface-label-retained')).toBeLessThan(
      promptText.indexOf('"actionTransitions"'),
    );
  });

  it('preserves retrieved group order so top-ranked procedures are not buried under UI', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'ranked-procedure',
          'procedure',
          JSON.stringify({
            sourceRunId: 'run-ranked-procedure',
            steps: [
              {
                stateIndex: '0',
                url: 'https://mobile.example.test/start',
              },
              {
                stateIndex: '1',
                url: 'https://mobile.example.test/result',
                action: "tap('qprimary-action')",
              },
            ],
          }),
        ),
        fact(
          'later-ui',
          'ui_inventory',
          JSON.stringify({
            url: 'https://mobile.example.test/result',
            surfaceLabels: ['qlater-ui-surface'],
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText.indexOf('#### Procedures')).toBeLessThan(
      promptText.indexOf('#### Observed UI and Surface Schema'),
    );
  });

  it('renders section text before detailed control inventories in UI memory', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'ui-section-text',
          'ui_inventory',
          JSON.stringify({
            url: 'https://workflow.example.test/profile/edit',
            sections: [
              {
                label: 'qprofile-card',
                controlNames: ['qedit-profile'],
                textSnippets: ['qprofile-text'],
              },
            ],
            actionControls: Array.from({ length: 20 }, (_, index) => ({
              role: 'button',
              name: `qaction-${index}`,
            })),
            contextRoleControls: [
              {
                label: 'qprofile-card',
                roleControls: { link: [{ role: 'link', name: 'qedit-profile' }] },
              },
            ],
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('qprofile-text');
    expect(promptText.indexOf('qprofile-text')).toBeLessThan(promptText.indexOf('actionControls'));
  });

  it('renders visible form text before detailed field inventories in UI memory', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'ui-visible-text',
          'ui_inventory',
          JSON.stringify({
            url: 'https://workflow.example.test/form-note',
            visibleTextSnippets: [
              {
                text: 'qimportant visible instruction for this form',
                contextLabels: ['qmain-surface'],
                index: 12,
              },
            ],
            fields: Array.from({ length: 12 }, (_, index) => ({
              label: `qfield-${index}`,
              role: 'textbox',
              controlName: `qfield-control-${index}`,
            })),
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('"visibleTextSnippets"');
    expect(promptText).toContain('qimportant visible instruction for this form');
    expect(promptText.indexOf('qimportant visible instruction')).toBeLessThan(
      promptText.indexOf('qfield-0'),
    );
  });

  it('renders ordered section controls before large field inventories in UI memory', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'ui-section-order',
          'ui_inventory',
          JSON.stringify({
            url: 'https://workflow.example.test/list',
            sections: [
              {
                label: 'qlist-toolbar',
                controlNames: [
                  'qfirst-column',
                  'qmiddle-column',
                  'qtarget-left',
                  'qtarget-right',
                  'qlate-column',
                ],
                controlCount: 64,
                firstControlIndex: 8,
              },
            ],
            fields: Array.from({ length: 40 }, (_, index) => ({
              order: index,
              label: `qfield-${index}`,
              role: 'combobox',
              controlName: `qfield-${index}`,
              options: Array.from(
                { length: 12 },
                (__, optionIndex) => `qoption-${index}-${optionIndex}`,
              ),
            })),
            actionControls: Array.from({ length: 48 }, (_, index) => ({
              role: 'button',
              name: `qaction-${index}`,
            })),
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('qtarget-left');
    expect(promptText).toContain('qtarget-right');
    expect(promptText).toContain('"adjacentControlPairs"');
    expect(promptText).toContain('["qtarget-left","qtarget-right"]');
    expect(promptText.indexOf('qtarget-left')).toBeLessThan(promptText.indexOf('qtarget-right'));
    expect(promptText.indexOf('qtarget-left')).toBeLessThan(promptText.indexOf('qfield-0'));
  });

  it('renders compact field symbol markers in UI memory', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'ui-symbol-field',
          'ui_inventory',
          JSON.stringify({
            fields: [
              {
                label: 'qfield',
                role: 'combobox',
                value: 'qvalue',
                displayText: 'qvalue ❤️',
                options: ['qvalue ❤️'],
                symbolMarkers: [{ glyph: '❤️', source: 'displayText', text: 'qvalue ❤️' }],
              },
            ],
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('field displayText');
    expect(promptText).toContain('"displayText":"qvalue ❤️"');
    expect(promptText).toContain(
      '"symbolMarkers":[{"glyph":"❤️","source":"displayText","text":"qvalue ❤️"}]',
    );
  });

  it('renders UI-bearing action outcomes as actionable outcomes before UI support', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'raw-ui',
          'ui_inventory',
          JSON.stringify({
            actionControls: [{ role: 'button', name: 'qraw-button' }],
          }),
        ),
        fact(
          'action-result',
          'outcome',
          JSON.stringify({
            action: "click('qadd')",
            thought: 'qpost-action-screen',
            sections: [
              {
                label: 'qnotice-panel',
                structuralPath: [{ role: 'main' }, { role: 'region', label: 'qproduct-page' }],
                textSnippets: ['qadded-notice'],
              },
            ],
            fields: [{ label: 'qquantity', role: 'spinbutton', value: '1' }],
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('#### Observed UI and Surface Schema');
    expect(promptText).toContain('#### Outcomes and Gotchas');
    expect(promptText.indexOf('#### Observed UI and Surface Schema')).toBeLessThan(
      promptText.indexOf('#### Outcomes and Gotchas'),
    );
    expect(promptText).toContain('"arrivalAction":"click');
    expect(promptText).toContain('qpost-action-screen');
    expect(promptText).toContain('qadded-notice');
    expect(promptText).toContain('qquantity');
  });

  it('prioritizes action-result surface and visible text before dense field evidence', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'dense-action-result',
          'outcome',
          JSON.stringify({
            action: "click('qexecute')",
            thought: 'qafter-action-state',
            surfaceLabels: ['qcritical-surface'],
            visibleTextSnippets: [
              {
                text: 'qimportant visible result text',
                contextLabels: ['qcritical-surface'],
                index: 7,
              },
            ],
            fieldLabels: Array.from({ length: 20 }, (_, index) => `qfield-${index}`),
            fields: Array.from({ length: 20 }, (_, index) => ({
              label: `qfield-${index}`,
              role: 'textbox',
              value: `qvalue-${index}`,
            })),
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('qcritical-surface');
    expect(promptText).toContain('qimportant visible result text');
    expect(promptText.indexOf('qimportant visible result text')).toBeLessThan(
      promptText.indexOf('qfield-0'),
    );
  });

  it('renders previous event context for compact action-result memory', () => {
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [
        fact(
          'previous-action-result',
          'outcome',
          JSON.stringify({
            action: "click('qsave')",
            thought: 'qcurrent-thought',
            previousAction: "fill('qfield', 'qvalue')",
            previousThought: 'qprevious-thought',
            previousStateIndex: '4',
            recentActionTrail: [
              {
                stateIndex: '3',
                action: "select_option('qmode', 'qtarget-mode')",
                thought: `${'qtrail-middle '.repeat(40)}qtrail-prerequisite-tail`,
              },
              {
                stateIndex: '4',
                action: "fill('qfield', 'qvalue')",
                thought: 'qprevious-thought',
              },
            ],
            surfaceLabels: ['qsurface'],
          }),
        ),
      ],
    }).sections.map((section) => section.text);
    const promptText = sections.join('\n');

    expect(promptText).toContain('stateTransition');
    expect(promptText).toContain('recentActionTrail');
    expect(promptText).toContain('observedAction');
    expect(promptText).toContain('arrivalAction');
    expect(promptText).toContain('stateThought');
    expect(promptText).toContain('immediatePriorObservation');
    expect(promptText).toContain('resultingObservation');
    expect(promptText).toContain('qtrail-prerequisite-tail');
    expect(promptText).toContain("fill('qfield', 'qvalue')");
    expect(promptText).toContain("click('qsave')");
    expect(promptText).toContain('qprevious-thought');
    expect(promptText).toContain('"stateIndex":"4"');
    expect(promptText.indexOf('stateTransition')).toBeLessThan(
      promptText.indexOf('immediatePriorObservation'),
    );
    expect(promptText.indexOf('immediatePriorObservation')).toBeLessThan(
      promptText.indexOf('resultingObservation'),
    );
    expect(promptText.indexOf('"resultingObservation"')).toBeLessThan(
      promptText.indexOf('"recentActionTrail"'),
    );
  });
});
