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
    expect(text.indexOf('## Identity & Style')).toBeLessThan(
      text.indexOf('## Persistent Memory'),
    );
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
            { action: 'write release notes', toolResult: 'created notes.md' },
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
    expect(text).toContain('read changelog');
    expect(text).toContain('notes.md was created');
    expect(text).not.toContain('Observed UI');
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
