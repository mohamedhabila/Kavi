import { BUILT_IN_PERSONAS } from '../../src/services/agents/personas';
import { buildE2EScenarioTraceSummary } from '../../src/acceptance/e2eAgent/e2eTraceSummary';
import { E2E_PUBLIC_BUILT_IN_PERSONA_IDS } from '../../src/acceptance/e2eAgent/e2eTraceExecutionPolicy';
import { getE2ENativeMobileFixtureStateSnapshot } from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import { buildFixtureResult } from '../helpers/e2eRunReportHarness';

const { projectPublicRedactedTrace } = require('../../scripts/e2eReport/publicTraceSchema');

const PRIVATE_SENTINELS = [
  'PRIVATE-CONVERSATION-ID',
  'PRIVATE-USER-MESSAGE-ID',
  'PRIVATE-USER-TEXT',
  'PRIVATE-CUSTOM-PERSONA',
  'PRIVATE-ASSISTANT-MESSAGE-ID',
  'PRIVATE-ASSISTANT-TEXT',
  'PRIVATE-FINISH-REASON',
  'PRIVATE-TERMINAL-REASON',
  'PRIVATE-RUN-ID',
  'PRIVATE-RUN-USER-ID',
  'PRIVATE-FACT-ID',
  'PRIVATE-FACT-SUBJECT',
  'PRIVATE-FACT-PREDICATE',
  'PRIVATE-FACT-CONTENT',
  'PRIVATE-EPISODE-ID',
  'PRIVATE-EPISODE-SUMMARY',
  'PRIVATE-BLOCK-ID',
  'PRIVATE-BLOCK-CONTENT',
  'PRIVATE-JOB-ID',
  'PRIVATE-RECEIPT-FACT-ID',
  'PRIVATE-DELTA-ID',
  'PRIVATE-NATIVE-STATE',
  'PRIVATE-NATIVE-TOOL',
  'PRIVATE-UNKNOWN-FIELD',
] as const;

function buildPrivateEvidenceResult(): E2EScenarioResult {
  const base = buildFixtureResult();
  const stateBefore = getE2ENativeMobileFixtureStateSnapshot();
  const stateAfter = JSON.parse(JSON.stringify(stateBefore)) as typeof stateBefore;
  stateAfter.clipboard.text = 'PRIVATE-NATIVE-STATE';
  stateAfter.clipboard.writeCount = 1;

  return buildFixtureResult({
    fixtureId: 'public-evidence-contract',
    conversationId: 'PRIVATE-CONVERSATION-ID',
    memoryFinalState: {
      capturedAt: 2,
      scope: {
        memoryConversationId: 'PRIVATE-CONVERSATION-ID',
        sourceThreadId: 'PRIVATE-CONVERSATION-ID',
      },
      facts: [
        {
          id: 'PRIVATE-FACT-ID',
          subjectId: 'PRIVATE-FACT-SUBJECT',
          predicate: 'PRIVATE-FACT-PREDICATE',
          objectText: 'PRIVATE-FACT-CONTENT',
          invalidAt: null,
          deletedAt: null,
        },
        { id: 'fact-invalidated', invalidAt: 2, deletedAt: null },
        { id: 'fact-deleted', invalidAt: null, deletedAt: 2 },
      ],
      episodes: [
        {
          id: 'PRIVATE-EPISODE-ID',
          summary: 'PRIVATE-EPISODE-SUMMARY',
          deletedAt: null,
        },
        { id: 'episode-deleted', summary: 'deleted', deletedAt: 2 },
      ],
      workingBlocks: [
        { id: 'PRIVATE-BLOCK-ID', content: 'PRIVATE-BLOCK-CONTENT' },
        { id: 'block-empty', content: '' },
      ],
      ingestionJobs: [
        {
          id: 'PRIVATE-JOB-ID',
          status: 'completed_enriched',
          providerOutcome: 'valid',
          outcomeCode: null,
        },
        {
          id: 'job-failed',
          status: 'failed',
          providerOutcome: 'provider_error',
          outcomeCode: 'processing_error',
        },
      ],
    } as E2EScenarioResult['memoryFinalState'],
    turnTraces: [
      {
        turnIndex: 0,
        lifecycleBefore: {
          boundary: 'app_relaunch',
          chatStore: 'rehydrated',
          memoryStore: 'reopened',
        },
        user: {
          messageId: 'PRIVATE-USER-MESSAGE-ID',
          text: 'PRIVATE-USER-TEXT',
          timestamp: 123,
        },
        route: {
          directive: 'forced_agentic',
          mode: 'agentic',
          personaId: 'PRIVATE-CUSTOM-PERSONA',
        },
        finalAssistant: {
          messageId: 'PRIVATE-ASSISTANT-MESSAGE-ID',
          text: 'PRIVATE-ASSISTANT-TEXT',
          timestamp: 124,
          completionStatus: 'complete',
          finishReason: 'PRIVATE-FINISH-REASON',
          terminalReason: 'PRIVATE-TERMINAL-REASON',
        },
        finalAssistantCandidateCount: 2,
        completion: {
          assistantStatus: 'complete',
          executionCompleted: true,
          finalResponseCompleted: true,
          runStatus: 'completed',
          runCompleted: true,
          runCompletedAt: 125,
          runTerminalReason: 'PRIVATE-TERMINAL-REASON',
          graphStatus: 'finalized',
          graphTerminalReason: 'PRIVATE-TERMINAL-REASON',
        },
        agentRun: {
          runId: 'PRIVATE-RUN-ID',
          userMessageId: 'PRIVATE-RUN-USER-ID',
          status: 'completed',
          currentPhase: 'deliver',
          createdAt: 100,
          updatedAt: 125,
          completedAt: 125,
          terminalReason: 'PRIVATE-TERMINAL-REASON',
          summary: {
            assistantTurns: 2,
            startedTools: 3,
            completedTools: 2,
            failedTools: 1,
            spawnedSubAgents: 1,
            durationMs: 25,
          },
        },
        memory: [
          {
            lifecycle: { factIds: ['PRIVATE-FACT-ID'] },
            job: {
              id: 'PRIVATE-JOB-ID',
              status: 'completed_enriched',
              providerOutcome: 'valid',
              outcomeCode: null,
            },
            receipts: [
              {
                jobId: 'PRIVATE-JOB-ID',
                attemptNumber: 1,
                episodeId: 'PRIVATE-EPISODE-ID',
                deterministicFactIds: ['PRIVATE-RECEIPT-FACT-ID'],
                providerFactIds: ['PRIVATE-FACT-ID'],
                invalidatedFactIds: ['PRIVATE-DELTA-ID'],
                bridgedEvidenceFactIds: [],
                agentRunMemoryFactIds: [],
                activeFocusUpdated: true,
                openThreadsUpdated: false,
                providerOutcome: 'valid',
                providerOutcomeCode: null,
                persistedAt: 2,
              },
            ],
          },
        ],
        memoryEvidence: {
          delta: {
            capturedAt: 2,
            facts: {
              createdIds: ['PRIVATE-DELTA-ID'],
              updatedIds: [],
              removedIds: [],
            },
            episodes: { createdIds: [], updatedIds: [], removedIds: [] },
            workingBlocks: { createdIds: [], updatedIds: [], removedIds: [] },
            ingestionJobs: {
              createdIds: ['PRIVATE-JOB-ID'],
              updatedIds: [],
              removedIds: [],
            },
            invalidatedFactIds: ['PRIVATE-DELTA-ID'],
            deletedFactIds: [],
            deletedEpisodeIds: [],
            clearedWorkingBlockIds: [],
            completedIngestionJobIds: ['PRIVATE-JOB-ID'],
          },
        },
        native: {
          stateBefore,
          stateAfter,
          invocations: [
            {
              sequence: 1,
              toolName: 'PRIVATE-NATIVE-TOOL',
              handled: true,
              resultStatus: 'PRIVATE-NATIVE-STATE',
              errorClass: null,
              stateBefore,
              stateAfter,
            },
          ],
        },
        toolCalls: [],
        toolResults: [],
        graphSnapshots: [],
        usage: base.usage,
        completed: true,
      },
    ] as E2EScenarioResult['turnTraces'],
    userTurnCount: 1,
  });
}

describe('public immutable E2E evidence projection', () => {
  it('keeps policy persona IDs synchronized with product built-ins', () => {
    expect([...E2E_PUBLIC_BUILT_IN_PERSONA_IDS].sort()).toEqual(
      BUILT_IN_PERSONAS.map((persona) => persona.id).sort(),
    );
  });

  it('projects only hashes, counts, allowlisted enums, and state fingerprints', () => {
    const trace = buildE2EScenarioTraceSummary({ result: buildPrivateEvidenceResult() });
    const serialized = JSON.stringify(trace);
    for (const sentinel of PRIVATE_SENTINELS) expect(serialized).not.toContain(sentinel);

    expect(trace.turns[0]).toMatchObject({
      lifecycleBefore: {
        boundary: 'app_relaunch',
        chatStore: 'rehydrated',
        memoryStore: 'reopened',
      },
      user: {
        messageIdHash: { length: 'PRIVATE-USER-MESSAGE-ID'.length },
        textHash: { length: 'PRIVATE-USER-TEXT'.length },
      },
      route: {
        directive: 'forced_agentic',
        mode: 'agentic',
        personaIdHash: { length: 'PRIVATE-CUSTOM-PERSONA'.length },
      },
      finalAssistant: {
        messageIdHash: { length: 'PRIVATE-ASSISTANT-MESSAGE-ID'.length },
        textHash: { length: 'PRIVATE-ASSISTANT-TEXT'.length },
        completionStatus: 'complete',
        finishReasonHash: { length: 'PRIVATE-FINISH-REASON'.length },
        terminalReasonHash: { length: 'PRIVATE-TERMINAL-REASON'.length },
      },
      finalAssistantCandidateCount: 2,
      completion: {
        executionCompleted: true,
        finalResponseCompleted: true,
        runStatus: 'completed',
        graphStatus: 'finalized',
        runTerminalReasonHash: { length: 'PRIVATE-TERMINAL-REASON'.length },
      },
      agentRun: {
        runIdHash: { length: 'PRIVATE-RUN-ID'.length },
        userMessageIdHash: { length: 'PRIVATE-RUN-USER-ID'.length },
        status: 'completed',
        phase: 'deliver',
        summary: { startedTools: 3, completedTools: 2, failedTools: 1 },
      },
      memoryDelta: {
        facts: { createdCount: 1 },
        ingestionJobs: { createdCount: 1 },
        invalidatedFactCount: 1,
        completedIngestionJobCount: 1,
        ingestion: {
          jobCount: 1,
          statusCounts: [{ value: 'completed_enriched', count: 1 }],
          providerOutcomeCounts: [{ value: 'valid', count: 1 }],
        },
        persistenceReceipts: {
          receiptCount: 1,
          maxAttemptNumber: 1,
          episodeCount: 1,
          deterministicFactCount: 1,
          providerFactCount: 1,
          invalidatedFactCount: 1,
          activeFocusUpdateCount: 1,
          providerOutcomeCounts: [{ value: 'valid', count: 1 }],
        },
      },
      native: {
        invocationCount: 1,
        handledInvocationCount: 1,
        changedStateFieldCount: 2,
        toolInvocations: [{ nameHash: { length: 'PRIVATE-NATIVE-TOOL'.length }, count: 1 }],
      },
    });
    expect(trace.turns[0]?.route).not.toHaveProperty('personaId');
    expect(trace.turns[0]?.user).not.toHaveProperty('timestamp');
    expect(trace.turns[0]?.finalAssistant).not.toHaveProperty('finishReason');
    expect(trace.turns[0]?.finalAssistant).not.toHaveProperty('timestamp');
    expect(trace.turns[0]?.agentRun).not.toHaveProperty('terminalReason');
    expect(trace.memoryFinal).toMatchObject({
      factCount: 3,
      activeFactCount: 1,
      invalidatedFactCount: 1,
      deletedFactCount: 1,
      episodeCount: 2,
      activeEpisodeCount: 1,
      deletedEpisodeCount: 1,
      workingBlockCount: 2,
      populatedWorkingBlockCount: 1,
      ingestion: {
        jobCount: 2,
        statusCounts: [
          { value: 'completed_enriched', count: 1 },
          { value: 'failed', count: 1 },
        ],
      },
    });
  });

  it('rebuilds a closed public DTO and rejects the old turn contract', () => {
    const trace = buildE2EScenarioTraceSummary({ result: buildPrivateEvidenceResult() });
    const hostile = JSON.parse(JSON.stringify(trace));
    hostile.privatePayload = 'PRIVATE-UNKNOWN-FIELD';
    hostile.turns[0].privatePayload = 'PRIVATE-UNKNOWN-FIELD';
    hostile.turns[0].user.text = 'PRIVATE-USER-TEXT';
    hostile.turns[0].finalAssistant.text = 'PRIVATE-ASSISTANT-TEXT';
    hostile.turns[0].agentRun.latestSummary = 'PRIVATE-ASSISTANT-TEXT';
    hostile.turns[0].route.personaId = 'PRIVATE-CUSTOM-PERSONA';
    hostile.turns[0].memoryDelta.facts.createdIds = ['PRIVATE-DELTA-ID'];
    hostile.memoryFinal.facts = [{ objectText: 'PRIVATE-FACT-CONTENT' }];
    hostile.turns[0].native.rawState = { text: 'PRIVATE-NATIVE-STATE' };

    const projected = projectPublicRedactedTrace(hostile);
    expect(projected).not.toBeNull();
    const serialized = JSON.stringify(projected);
    for (const sentinel of PRIVATE_SENTINELS) expect(serialized).not.toContain(sentinel);
    expect(projected).toEqual(projectPublicRedactedTrace(projected));
    expect(projected.turns[0].user).toEqual(trace.turns[0]?.user);
    expect(projected.turns[0].route).not.toHaveProperty('personaId');

    const oldTurn = JSON.parse(JSON.stringify(trace));
    delete oldTurn.turns[0].user;
    expect(projectPublicRedactedTrace(oldTurn)).toBeNull();

    const missingLifecycle = JSON.parse(JSON.stringify(trace));
    delete missingLifecycle.turns[0].lifecycleBefore;
    expect(projectPublicRedactedTrace(missingLifecycle)).toBeNull();

    const invalidLifecycle = JSON.parse(JSON.stringify(trace));
    invalidLifecycle.turns[0].lifecycleBefore.boundary = 'PRIVATE-UNKNOWN-FIELD';
    expect(projectPublicRedactedTrace(invalidLifecycle)).toBeNull();
  });

  it('publishes built-in persona IDs while still hashing them', () => {
    const result = buildPrivateEvidenceResult();
    const turn = result.turnTraces[0] as { route: { personaId: string } };
    turn.route.personaId = 'super-agent';
    const trace = buildE2EScenarioTraceSummary({ result });
    expect(trace.turns[0]?.route).toMatchObject({
      personaId: 'super-agent',
      personaIdHash: { length: 'super-agent'.length },
    });
  });
});
