import { projectAgentRunExperienceViews } from '../../../src/services/memory/experienceRecords';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function agentRunFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-agent-run-1',
    subjectId: 'subject-1',
    predicate: 'agent_run',
    objectText: JSON.stringify({
      domain: 'mobile',
      environment: 'android-reference',
      status: 'completed',
      outcome: 'Receipt verified',
      evidenceSlices: [
        { action: 'Open settings', toolName: 'mobile_observe', status: 'completed' },
      ],
      preconditions: ['User is signed in'],
      artifacts: ['workspace/report.md'],
      decisions: ['Use the native settings surface'],
      gotchas: ['Permission dialog may appear'],
    }),
    objectEntityId: null,
    attributes: {},
    confidence: 0.82,
    sourceMessageId: 'message-1',
    sourceRunId: 'run-1',
    memoryOwnerId: 'owner-1',
    personaId: 'default',
    factClass: 'workflow',
    sourceAuthority: 'tool_observed',
    scope: 'session',
    originConversationId: 'conversation-1',
    originThreadId: 'thread-1',
    originTaskId: 'task-1',
    sourceTurnId: 'turn-1',
    sourceSummary: null,
    importance: 0.8,
    accessCount: 0,
    repeatedMentionCount: 0,
    lastRecalledAt: null,
    lastReinforcedAt: null,
    lastAccessedAt: null,
    decayPolicy: 'normal',
    expiresAt: null,
    contentHash: 'hash-1',
    localSimilarity: null,
    validAt: 10,
    invalidAt: null,
    createdAt: 10,
    updatedAt: 10,
    deletedAt: null,
    pinned: false,
    sourceActorId: null,
    retrievability: 0.8,
    stability: 0.7,
    decayRate: 0.03,
    lastPresentedAt: null,
    lastConfirmedAt: null,
    lastConflictedAt: null,
    reviewState: 'auto',
    sensitivity: 'normal',
    memoryKind: 'agent_run',
    ...overrides,
  };
}

describe('typed experience record projection', () => {
  it('exposes bounded typed views linked to exact raw run evidence', () => {
    const views = projectAgentRunExperienceViews(agentRunFact());

    expect(views.map((view) => view.kind)).toEqual([
      'procedure',
      'precondition',
      'outcome',
      'artifact',
      'decision',
      'gotcha',
    ]);
    expect(views[0]).toEqual(
      expect.objectContaining({
        evidence: {
          factId: 'fact-agent-run-1',
          contentHash: 'hash-1',
          sourceRunId: 'run-1',
          sourceTurnId: 'turn-1',
          sourceMessageId: 'message-1',
          sourceAuthority: 'tool_observed',
        },
        applicability: {
          conversationId: 'conversation-1',
          threadId: 'thread-1',
          taskId: 'task-1',
          domain: 'mobile',
          environment: 'android-reference',
          generalization: 'single_run',
        },
      }),
    );
  });

  it('uses attributes as the authoritative structured record', () => {
    const views = projectAgentRunExperienceViews(
      agentRunFact({
        attributes: {
          status: 'failed',
          outcome: 'Permission denied',
          risks: ['Request permission before retry'],
        },
        confidence: 0.95,
      }),
    );

    expect(views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'failure',
          status: 'failed',
          detail: 'Permission denied',
          confidence: 0.5,
          applicability: expect.objectContaining({ generalization: 'single_run' }),
        }),
        expect.objectContaining({
          kind: 'gotcha',
          values: expect.arrayContaining(['Request permission before retry']),
        }),
      ]),
    );
  });

  it('does not invent preconditions, failures, or gotchas from free-form outcome prose', () => {
    const views = projectAgentRunExperienceViews(
      agentRunFact({
        objectText: JSON.stringify({
          status: 'completed',
          outcome: 'This text mentions failure and permissions but is a successful outcome.',
        }),
      }),
    );

    expect(views.map((view) => view.kind)).toEqual(['outcome']);
  });

  it('fails closed when raw provenance or scope identity is malformed', () => {
    expect(projectAgentRunExperienceViews(agentRunFact({ sourceRunId: ' run-1' }))).toEqual([]);
    expect(
      projectAgentRunExperienceViews(agentRunFact({ originConversationId: 'conversation 1' })),
    ).toEqual([]);
    expect(projectAgentRunExperienceViews(agentRunFact({ sourceMessageId: '' }))).toEqual([]);
  });

  it('ignores non-run facts and bounds record arrays and strings', () => {
    expect(projectAgentRunExperienceViews(agentRunFact({ memoryKind: 'semantic_fact' }))).toEqual(
      [],
    );
    const artifacts = Array.from({ length: 20 }, (_, index) => `artifact-${index}`);
    const views = projectAgentRunExperienceViews(
      agentRunFact({
        objectText: JSON.stringify({
          artifacts,
          evidenceSlices: Array.from({ length: 20 }, (_, index) => ({
            action: index === 0 ? `step-${index}-${'x'.repeat(900)}` : `step-${index}`,
          })),
        }),
      }),
    );
    const artifactView = views.find((view) => view.kind === 'artifact');
    const procedureView = views.find((view) => view.kind === 'procedure');
    expect(artifactView?.kind === 'artifact' ? artifactView.values : []).toHaveLength(12);
    expect(procedureView?.kind === 'procedure' ? procedureView.steps : []).toHaveLength(12);
    expect(
      procedureView?.kind === 'procedure' ? procedureView.steps[0]?.action?.length : 0,
    ).toBeLessThanOrEqual(800);
  });
});
