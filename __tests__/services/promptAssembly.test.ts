// ---------------------------------------------------------------------------
// Tests - Prompt assembly (4-layer + cache breakpoint)
// ---------------------------------------------------------------------------

import {
  assemblePrompt,
  flattenPromptSections,
  type AssemblePromptInput,
} from '../../src/services/memory/promptAssembly';
import type { MemoryBlock } from '../../src/services/memory/blocks';
import type { MemoryEpisode } from '../../src/services/memory/episodes/types';
import type { MemoryFact, MemoryFactKind } from '../../src/services/memory/facts/types';

function makeBlock(overrides: Partial<MemoryBlock> = {}): MemoryBlock {
  return {
    label: 'profile',
    description: 'Stable facts about the user.',
    content: 'Name: Mo\nRole: Engineer',
    charLimit: 1500,
    pinned: true,
    personaId: null,
    updatedAt: 1,
    ...overrides,
  };
}

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'f1',
    subjectId: 'user',
    predicate: 'lives_in',
    objectText: 'Berlin',
    objectEntityId: null,
    attributes: {},
    confidence: 0.9,
    sourceMessageId: null,
    sourceRunId: null,
    scope: 'conversation',
    originConversationId: 'conv-1',
    originThreadId: 'conv-1',
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
    contentHash: 'h',
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
    stability: 0.8,
    decayRate: 0.01,
    lastPresentedAt: null,
    lastConfirmedAt: null,
    lastConflictedAt: null,
    reviewState: 'auto',
    sensitivity: 'normal',
    memoryKind: 'semantic_fact',
    ...overrides,
  };
}

function makeAgentFact(
  id: string,
  memoryKind: MemoryFactKind,
  objectText: Record<string, unknown>,
): MemoryFact {
  return makeFact({
    id,
    subjectId: 'task',
    predicate: memoryKind === 'procedure' ? 'agent_run_trace' : 'agent_run_result',
    objectText: JSON.stringify(objectText),
    sourceRunId: `run-${id}`,
    contentHash: `hash-${id}`,
    memoryKind,
  });
}

function makeEpisode(overrides: Partial<MemoryEpisode> = {}): MemoryEpisode {
  return {
    id: 'ep-1',
    conversationId: 'conv-1',
    threadId: 'conv-1',
    taskId: null,
    startedAt: 1,
    endedAt: 2,
    summary: 'User asked to fix the config file.',
    entities: ['user'],
    messageIds: ['m1', 'm2'],
    toolNames: ['read_file'],
    importance: 0.7,
    embedding: null,
    createdAt: 2,
    deletedAt: null,
    ...overrides,
  };
}

const baseInput: AssemblePromptInput = {
  basePrompt: 'You are Kavi, a personal assistant.',
};

describe('assemblePrompt - layer ordering', () => {
  it('emits L1 first, L2 second, L3 last', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      blocks: [makeBlock({ content: 'BLOCK' })],
      focusBlock: '<focus>FOCUS</focus>',
    });
    const text = flattenPromptSections(out.sections);
    expect(text.indexOf('## Identity & Style')).toBeLessThan(text.indexOf('## Persistent Memory'));
    expect(text.indexOf('## Persistent Memory')).toBeLessThan(text.indexOf('## This Turn'));
  });

  it('only marks stable base policy as cacheable', () => {
    const out = assemblePrompt({
      ...baseInput,
      blocks: [makeBlock()],
      retrievedFacts: [makeFact()],
    });
    expect(out.sections.filter((section) => section.cacheable)).toHaveLength(1);
    expect(out.sections[0]?.text).toContain('## Identity & Style');
  });
});

describe('assemblePrompt - product memory groups', () => {
  it('renders compact procedure and outcome evidence in workflow sections', () => {
    const out = assemblePrompt({
      ...baseInput,
      retrievedFacts: [
        makeAgentFact('procedure', 'procedure', {
          sourceRunId: 'run-procedure',
          goal: 'Prepare release notes',
          steps: [
            { action: 'read changelog', toolName: 'read_file' },
            {
              action: 'write release notes',
              observation: 'editor shows notes.md ready to save',
              toolResult: 'created notes.md',
            },
          ],
        }),
        makeAgentFact('outcome', 'outcome', {
          sourceRunId: 'run-outcome',
          goal: 'Prepare release notes',
          outcome: 'notes.md was created',
          artifacts: ['notes.md'],
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('#### Procedures');
    expect(text).toContain('#### Outcomes and Tool Results');
    expect(text.indexOf('#### Procedures')).toBeLessThan(
      text.indexOf('#### Outcomes and Tool Results'),
    );
    expect(text).toContain('complete observed workflow traces');
    expect(text).toContain('do not reduce a successful trace to only its last action');
    expect(text).toContain(
      'treat that observed action set as direct evidence of both available and unavailable actions',
    );
    expect(text).toContain('do not invent missing actions');
    expect(text).toContain('Grouped observed action sections are siblings');
    expect(text).toContain('relevant actions in sibling groups are not substitutes');
    expect(text).toContain('read changelog');
    expect(text).toContain('editor shows notes.md ready to save');
    expect(text).toContain('notes.md was created');
    expect(text).not.toContain('Observed UI');
  });

  it('renders query-focused excerpts from long tool observations', () => {
    const out = assemblePrompt({
      ...baseInput,
      retrievalQuery: 'needle',
      retrievedFacts: [
        makeAgentFact('outcome', 'outcome', {
          sourceRunId: 'run-outcome',
          goal: 'Inspect a long tool result',
          outcome: 'inspection completed',
          lastSteps: [
            {
              action: 'inspect',
              observation: [
                'unrelated line 1',
                'unrelated line 2',
                'needle line carries the relevant evidence',
                'unrelated line 3',
                'unrelated line 4',
                'unrelated line 5',
              ].join('\n'),
            },
          ],
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('needle line carries the relevant evidence');
    expect(text).not.toContain('unrelated line 5');
  });

  it('renders exact observed affordances from source-backed agent memories', () => {
    const out = assemblePrompt({
      ...baseInput,
      retrievedFacts: [
        makeAgentFact('procedure', 'procedure', {
          sourceRunId: 'run-procedure',
          goal: 'Inspect the current workflow surface',
          steps: [
            {
              stateIndex: 4,
              action: 'open controls',
              observedAffordances: [
                {
                  role: 'menuitem',
                  label: 'Incident Mobile',
                  attributes: 'visible',
                  section: 'Incident Actions',
                },
                {
                  role: 'menuitem',
                  label: 'Incident Portal',
                  attributes: 'visible',
                  section: 'Incident Actions',
                },
              ],
              inputControlsPresent: false,
            },
          ],
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('observedAffordances');
    expect(text).toContain('availableActions');
    expect(text).toContain('Incident Actions');
    expect(text).toContain('Incident Mobile');
    expect(text).toContain('Incident Portal');
    expect(text).toContain('inputControlsPresent');
  });

  it('renders observed control source order for action and column evidence', () => {
    const out = assemblePrompt({
      ...baseInput,
      retrievalQuery: 'Which controls are next to Approve?',
      retrievedFacts: [
        makeAgentFact('procedure', 'procedure', {
          sourceRunId: 'run-procedure',
          goal: 'Inspect a workflow surface',
          steps: [
            {
              stateIndex: 4,
              action: 'inspect controls',
              observedControlSequence: [
                { role: 'button', label: 'Open', attributes: 'visible' },
                { role: 'button', label: 'Review', attributes: 'visible' },
                { role: 'button', label: 'Approve', attributes: 'visible' },
                { role: 'button', label: 'Archive', attributes: 'visible' },
                { role: 'columnheader', label: 'Name', attributes: 'visible' },
                { role: 'columnheader', label: 'Status', attributes: 'visible' },
              ],
            },
          ],
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('observedControlSequence');
    expect(text).toContain('source order');
    expect(text.indexOf('Open')).toBeLessThan(text.indexOf('Review'));
    expect(text.indexOf('Review')).toBeLessThan(text.indexOf('Approve'));
    expect(text.indexOf('Approve')).toBeLessThan(text.indexOf('Archive'));
    expect(text.indexOf('Name')).toBeLessThan(text.indexOf('Status'));
  });

  it('renders query-relevant observed outcome evidence before bulky metadata', () => {
    const out = assemblePrompt({
      ...baseInput,
      retrievalQuery: 'incident filter option labels',
      retrievedFacts: [
        makeAgentFact('outcome', 'outcome', {
          sourceRunId: 'run-outcome',
          goal: 'A long completed task description that should not hide observed evidence.',
          status: 'completed',
          outcome: 'inspection completed',
          sources: [
            'https://example.test/a/very/long/source/url/that/is/useful/metadata',
            'https://example.test/another/source/url/that/is/useful/metadata',
          ],
          lastSteps: [
            {
              stateIndex: 1,
              action: 'open unrelated page',
              observation: 'RootWebArea "Incidents"',
            },
            {
              stateIndex: 2,
              action: 'open controls',
              observedAffordances: [
                { role: 'menuitem', label: 'Incident Mobile', attributes: 'visible' },
                { role: 'menuitem', label: 'Incident Portal', attributes: 'visible' },
                { role: 'menuitem', label: 'My Open Incidents', attributes: 'visible' },
              ],
              inputControlsPresent: false,
            },
          ],
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('Incident Mobile');
    expect(text.indexOf('Incident Mobile')).toBeLessThan(text.indexOf('RootWebArea'));
    expect(text.indexOf('lastSteps')).toBeLessThan(text.indexOf('sources'));
    expect(text.indexOf('sources')).toBeLessThan(text.indexOf('goal'));
  });

  it('renders exact delimited request-anchor evidence before generic step matches', () => {
    const out = assemblePrompt({
      ...baseInput,
      retrievalQuery: 'On the `Project Alpha Console`, which controls are visible?',
      retrievedFacts: [
        makeAgentFact('outcome', 'outcome', {
          sourceRunId: 'run-outcome',
          status: 'completed',
          outcome: 'inspection completed',
          lastSteps: [
            {
              stateIndex: 1,
              action: 'inspect earlier settings',
              thought:
                'The current form has visible controls and a list of fields, but it is not the named surface.',
              observedAffordances: [
                { role: 'textbox', label: 'Generic Name', attributes: 'visible' },
                { role: 'combobox', label: 'Generic State', attributes: 'visible' },
              ],
            },
            {
              stateIndex: 2,
              action: 'inspect target surface',
              thought: 'The Project Alpha Console is open and ready for review.',
              observedAffordances: [
                { role: 'button', label: 'Approve', attributes: 'visible' },
                { role: 'button', label: 'Escalate', attributes: 'visible' },
              ],
            },
          ],
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('Project Alpha Console');
    expect(text).toContain('Approve');
    expect(text.indexOf('Project Alpha Console')).toBeLessThan(text.indexOf('Generic Name'));
  });

  it('groups decisions, risks, artifacts, sources, and summaries separately', () => {
    const out = assemblePrompt({
      ...baseInput,
      retrievedFacts: [
        makeFact({
          id: 'decision',
          predicate: 'architecture_decision',
          objectText: 'Use compact agent-run memory records.',
          memoryKind: 'decision',
        }),
        makeFact({
          id: 'risk',
          predicate: 'implementation_risk',
          objectText: 'Do not let retrieval latency block the chat turn.',
          memoryKind: 'risk',
        }),
        makeFact({
          id: 'artifact',
          predicate: 'created_artifact',
          objectText: 'reports/analysis.json',
          memoryKind: 'artifact',
        }),
        makeFact({
          id: 'summary',
          predicate: 'run_summary',
          objectText: 'The benchmark smoke run used isolated memory.',
          memoryKind: 'summary',
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('#### Decisions and Risks');
    expect(text).toContain('#### Artifacts and Sources');
    expect(text).toContain('#### Summaries');
  });
});

describe('assemblePrompt - dynamic context', () => {
  it('renders focus, reflection, and episodes in L3', () => {
    const out = assemblePrompt({
      ...baseInput,
      focusBlock: '<focus>Ship memory cleanup</focus>',
      reflectionBlock: 'Memory retrieval was noisy yesterday.',
      recentEpisodes: [makeEpisode()],
    });
    const text = flattenPromptSections(out.sections);
    expect(text).toContain('### Day Focus');
    expect(text).toContain('Ship memory cleanup');
    expect(text).toContain('### Recent Activity');
    expect(text).toContain('User asked to fix the config file.');
  });
});
