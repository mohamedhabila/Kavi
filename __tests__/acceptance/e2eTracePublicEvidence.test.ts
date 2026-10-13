import { BUILT_IN_PERSONAS } from '../../src/services/agents/personas';
import { buildE2EScenarioTraceSummary } from '../../src/acceptance/e2eAgent/e2eTraceSummary';
import {
  E2E_PUBLIC_BUILT_IN_PERSONA_IDS,
  E2E_PUBLIC_MAX_FINAL_ASSISTANT_TEXT_LENGTH,
} from '../../src/acceptance/e2eAgent/e2eTraceExecutionPolicy';
import { getE2ENativeMobileFixtureStateSnapshot } from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import { buildFixtureResult } from '../helpers/e2eRunReportHarness';

const { projectPublicRedactedTrace } = require('../../scripts/e2eReport/publicTraceSchema');
const {
  projectAgentRunEvidence,
  projectCompletionEvidence,
  projectFinalAssistantEvidence,
  projectRouteEvidence,
  projectUserEvidence,
} = require('../../scripts/e2eReport/publicTraceExecution');
const {
  projectMemoryFinalEvidence,
  projectMemoryTurnEvidence,
} = require('../../scripts/e2eReport/publicTraceMemory');
const {
  projectNativeTurnEvidence,
  projectStateFingerprints,
} = require('../../scripts/e2eReport/publicTraceNative');
const { SAFE_NATIVE_FIXTURE_PATHS } = require('../../scripts/e2eReport/publicTraceUsage');
const { projectValueFingerprint } = require('../../scripts/e2eReport/publicTraceValues');

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
  'PRIVATE-MEMORY-ID',
  'PRIVATE-MEMORY-CONTENT',
  'PRIVATE-OLD-MEMORY-ID',
  'PRIVATE-OLD-MEMORY-CONTENT',
  'PRIVATE-SENSITIVE-MEMORY',
  'PRIVATE-TURN-ID',
  'PRIVATE-NATIVE-STATE',
  'PRIVATE-NATIVE-TOOL',
  'PRIVATE-UNKNOWN-FIELD',
] as const;

function privateItem(
  id: string,
  text: string,
  extra: Partial<E2EScenarioResult['memoryItems']['items'][number]> = {},
): E2EScenarioResult['memoryItems']['items'][number] {
  return {
    id,
    text,
    pinned: false,
    sensitive: false,
    supersededBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function buildPrivateEvidenceResult(): E2EScenarioResult {
  const base = buildFixtureResult();
  const stateBefore = getE2ENativeMobileFixtureStateSnapshot();
  const stateAfter = JSON.parse(JSON.stringify(stateBefore)) as typeof stateBefore;
  stateAfter.clipboard.text = 'PRIVATE-NATIVE-STATE';
  stateAfter.clipboard.writeCount = 1;

  return buildFixtureResult({
    fixtureId: 'public-evidence-contract',
    conversationId: 'PRIVATE-CONVERSATION-ID',
    memoryItems: {
      capturedAt: 2,
      items: [
        privateItem('PRIVATE-OLD-MEMORY-ID', 'PRIVATE-OLD-MEMORY-CONTENT', {
          supersededBy: 'PRIVATE-MEMORY-ID',
        }),
        privateItem('PRIVATE-MEMORY-ID', 'PRIVATE-MEMORY-CONTENT', { pinned: true }),
        privateItem('PRIVATE-SENSITIVE-MEMORY-ID', 'PRIVATE-SENSITIVE-MEMORY', {
          sensitive: true,
        }),
      ],
      indexedTurnCount: 3,
    },
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
        memoryPrompt: {
          status: 'recorded',
          builds: [
            {
              itemIds: ['PRIVATE-MEMORY-ID'],
              turnIds: ['PRIVATE-TURN-ID'],
              chars: 120,
              durationMs: 4,
            },
          ],
        },
        memoryExtractionSettled: true,
        memoryExtractionWaitMs: 1200,
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
        textLength: 'PRIVATE-ASSISTANT-TEXT'.length,
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
      memory: {
        extractionSettled: true,
        extractionWaitMs: 1200,
        promptStatus: 'recorded',
        promptBuildCount: 1,
        promptItemCount: 1,
        promptTurnCount: 1,
        maxPromptChars: 120,
        maxPromptBuildMs: 4,
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
    expect(trace.memoryFinal).toEqual({
      itemCount: 3,
      currentItemCount: 2,
      supersededItemCount: 1,
      pinnedItemCount: 1,
      sensitiveItemCount: 1,
      indexedTurnCount: 3,
    });
  });

  it('projects only a product-created zero-message new-conversation boundary', () => {
    const result = buildPrivateEvidenceResult();
    const turn = result.turnTraces[0] as unknown as {
      lifecycleBefore: E2EScenarioResult['turnTraces'][number]['lifecycleBefore'];
    };
    turn.lifecycleBefore = {
      boundary: 'context_reset',
      chatStore: 'context_archived',
      memoryStore: 'shared_global',
      previousLiveMessageCount: 2,
      liveMessageCountAfter: 0,
    };

    const trace = buildE2EScenarioTraceSummary({ result });
    expect(trace.turns[0]?.lifecycleBefore).toEqual(turn.lifecycleBefore);
    expect(projectPublicRedactedTrace(trace)?.turns[0]?.lifecycleBefore).toEqual(
      turn.lifecycleBefore,
    );

    const polluted = JSON.parse(JSON.stringify(trace));
    polluted.turns[0].lifecycleBefore.liveMessageCountAfter = 1;
    expect(projectPublicRedactedTrace(polluted)).toBeNull();
  });

  it('rebuilds a closed public DTO and rejects the old turn contract', () => {
    const trace = buildE2EScenarioTraceSummary({ result: buildPrivateEvidenceResult() });
    expect(SAFE_NATIVE_FIXTURE_PATHS.has('calendar.lastCreatedEventId')).toBe(true);
    expect(SAFE_NATIVE_FIXTURE_PATHS.has('calendar.lastCreatedTitle')).toBe(true);
    const sourceTurn = trace.turns[0];
    expect(projectUserEvidence(sourceTurn?.user)).not.toBeNull();
    expect(projectRouteEvidence(sourceTurn?.route)).not.toBeNull();
    expect(projectFinalAssistantEvidence(sourceTurn?.finalAssistant)).not.toBeUndefined();
    expect(projectCompletionEvidence(sourceTurn?.completion)).not.toBeNull();
    expect(projectAgentRunEvidence(sourceTurn?.agentRun)).not.toBeUndefined();
    expect(projectMemoryTurnEvidence(sourceTurn?.memory)).not.toBeNull();
    expect(projectMemoryFinalEvidence(trace.memoryFinal)).not.toBeNull();
    const invalidFingerprint = sourceTurn?.native.stateBeforeFingerprints.find(
      (fingerprint) => projectValueFingerprint(fingerprint, SAFE_NATIVE_FIXTURE_PATHS) === null,
    );
    expect(invalidFingerprint?.fieldPath).toBeUndefined();
    expect(projectStateFingerprints(sourceTurn?.native.stateBeforeFingerprints)).not.toBeNull();
    expect(projectStateFingerprints(sourceTurn?.native.stateAfterFingerprints)).not.toBeNull();
    expect(projectNativeTurnEvidence(sourceTurn?.native)).not.toBeNull();
    expect(projectPublicRedactedTrace(trace)).not.toBeNull();
    const hostile = JSON.parse(JSON.stringify(trace));
    hostile.privatePayload = 'PRIVATE-UNKNOWN-FIELD';
    hostile.turns[0].privatePayload = 'PRIVATE-UNKNOWN-FIELD';
    hostile.turns[0].user.text = 'PRIVATE-USER-TEXT';
    hostile.turns[0].finalAssistant.text = 'PRIVATE-ASSISTANT-TEXT';
    hostile.turns[0].agentRun.latestSummary = 'PRIVATE-ASSISTANT-TEXT';
    hostile.turns[0].route.personaId = 'PRIVATE-CUSTOM-PERSONA';
    hostile.turns[0].memory.itemIds = ['PRIVATE-MEMORY-ID'];
    hostile.memoryFinal.items = [{ text: 'PRIVATE-MEMORY-CONTENT' }];
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

  it('rejects unknown strict enums and invalid numeric counters before redaction', () => {
    const invalidRoute = buildPrivateEvidenceResult();
    const route = invalidRoute.turnTraces[0]?.route as unknown as { mode: string };
    route.mode = 'PRIVATE-UNKNOWN-FIELD';
    expect(() => buildE2EScenarioTraceSummary({ result: invalidRoute })).toThrow(
      'turn.route.mode contains an unsupported enum value.',
    );

    const invalidCounter = buildPrivateEvidenceResult();
    const turn = invalidCounter.turnTraces[0] as unknown as {
      finalAssistantCandidateCount: number;
    };
    turn.finalAssistantCandidateCount = -1;
    expect(() => buildE2EScenarioTraceSummary({ result: invalidCounter })).toThrow(
      'turn.finalAssistantCandidateCount must be a non-negative safe integer.',
    );

    const invalidUsage = buildPrivateEvidenceResult();
    const usage = invalidUsage.usage as unknown as { inputTokens: number };
    usage.inputTokens = Number.NaN;
    expect(() => buildE2EScenarioTraceSummary({ result: invalidUsage })).toThrow(
      'usage.inputTokens must be a non-negative safe integer.',
    );

    const invalidCacheEnum = buildPrivateEvidenceResult();
    const cacheUsage = invalidCacheEnum.usage as unknown as {
      promptCache: Record<string, unknown>;
    };
    cacheUsage.promptCache = {
      eligibleTurnCount: 1,
      enabledTurnCount: 1,
      skippedTurnCount: 0,
      createEventCount: 1,
      reuseEventCount: 0,
      providerManagedEventCount: 0,
      thresholdTokens: [1],
      explicitCacheNames: [],
      reasonCounts: [],
      events: [
        {
          eligible: true,
          enabled: true,
          estimatedInputTokens: 1,
          thresholdTokens: 1,
          providerFamily: 'custom',
          mode: 'PRIVATE-UNKNOWN-FIELD',
          event: 'create',
          reason: 'unknown',
        },
      ],
    };
    expect(() => buildE2EScenarioTraceSummary({ result: invalidCacheEnum })).toThrow(
      'promptCache.event.mode contains an unsupported enum value.',
    );
  });

  it('rejects malformed public enums, counters, and assistant text lengths', () => {
    const trace = buildE2EScenarioTraceSummary({ result: buildPrivateEvidenceResult() });
    type MutableTrace = {
      durationMs: number;
      memoryFinal: { currentItemCount: number };
      turns: Array<{
        memory: { promptStatus: string; extractionSettled: unknown };
        route: { mode: string };
        agentRun: { summary: { startedTools: number } };
        finalAssistant: { textLength: number };
      }>;
    };
    const mutate = (change: (candidate: MutableTrace) => void): MutableTrace => {
      const candidate = JSON.parse(JSON.stringify(trace)) as MutableTrace;
      change(candidate);
      return candidate;
    };

    expect(
      projectPublicRedactedTrace(
        mutate((candidate) => {
          candidate.turns[0].route.mode = 'OTHER';
        }),
      ),
    ).toBeNull();
    expect(
      projectPublicRedactedTrace(
        mutate((candidate) => {
          candidate.memoryFinal.currentItemCount += 1;
        }),
      ),
    ).toBeNull();
    expect(
      projectPublicRedactedTrace(
        mutate((candidate) => {
          candidate.turns[0].memory.promptStatus = 'PRIVATE-UNKNOWN-FIELD';
        }),
      ),
    ).toBeNull();
    expect(
      projectPublicRedactedTrace(
        mutate((candidate) => {
          candidate.turns[0].memory.extractionSettled = 'yes';
        }),
      ),
    ).toBeNull();
    expect(
      projectPublicRedactedTrace(
        mutate((candidate) => {
          candidate.turns[0].agentRun.summary.startedTools = Number.POSITIVE_INFINITY;
        }),
      ),
    ).toBeNull();
    expect(
      projectPublicRedactedTrace(
        mutate((candidate) => {
          candidate.durationMs = -1;
        }),
      ),
    ).toBeNull();
    expect(
      projectPublicRedactedTrace(
        mutate((candidate) => {
          candidate.turns[0].finalAssistant.textLength += 1;
        }),
      ),
    ).toBeNull();
    expect(
      projectPublicRedactedTrace(
        mutate((candidate) => {
          candidate.turns[0].finalAssistant.textLength =
            E2E_PUBLIC_MAX_FINAL_ASSISTANT_TEXT_LENGTH + 1;
        }),
      ),
    ).toBeNull();
  });

  it('rejects assistant text beyond the public diagnostic bound', () => {
    const result = buildPrivateEvidenceResult();
    const assistant = result.turnTraces[0]?.finalAssistant as unknown as { text: string };
    assistant.text = 'x'.repeat(E2E_PUBLIC_MAX_FINAL_ASSISTANT_TEXT_LENGTH + 1);
    expect(() => buildE2EScenarioTraceSummary({ result })).toThrow(
      'finalAssistant.text exceeds the public trace length bound.',
    );
  });
});
