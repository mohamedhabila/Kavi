import { createGoal } from '../../../src/engine/goals/types';
import { resolveSubAgentRunOutput } from '../../../src/services/agents/lifecycle/terminalOutputResolution';
import { enforceExecutionWorkerOutputContract } from '../../../src/services/agents/subAgentOutputContract';
import { buildSubAgentTerminalControlGraphEvents } from '../../../src/services/agents/subAgentGoalGraphEffects';
import type { AgentRunControlGraphState } from '../../../src/types/agentRun';
import type { LlmProviderConfig } from '../../../src/types/provider';
import type { SubAgentSnapshot } from '../../../src/types/subAgent';

jest.mock('../../../src/services/agents/subAgentFinalization', () => ({
  synthesizeSubAgentFinalAnswer: jest.fn(),
}));

// Live on `delegation-worker-finalize`, a worker asked only to return a token returned it
// in 1.2 s, ended with no completion state, and was filed as incomplete — so its goal
// never received worker evidence and the supervisor ended blocked. A worker's delivery is
// now read from how its run ended.

const ANSWER = 'E2E-WORKER-EVIDENCE-42';

function contract(overrides: Partial<Parameters<typeof enforceExecutionWorkerOutputContract>[0]>) {
  return enforceExecutionWorkerOutputContract({
    output: ANSWER,
    terminalStatus: 'completed',
    terminalDisposition: 'final_candidate',
    ...overrides,
  });
}

describe('a worker', () => {
  it('has delivered when its run ends with a final answer', () => {
    expect(contract({})).toEqual({ output: ANSWER, completionState: 'verified_success' });
  });

  it('keeps a state it declares itself', () => {
    expect(contract({ output: `Could not reach the source.\ncompletion_state: blocked` })).toEqual({
      output: 'Could not reach the source.',
      completionState: 'blocked',
    });
  });

  it.each(['blocked', 'yielded', 'waiting', 'failed'] as const)(
    'has not delivered when its run ends %s',
    (terminalDisposition) => {
      expect(contract({ terminalDisposition }).completionState).toBe('incomplete');
    },
  );

  it('has not delivered when its run did not complete', () => {
    expect(contract({ terminalStatus: 'timeout' }).completionState).toBe('incomplete');
  });

  it('has not delivered an empty report', () => {
    expect(contract({ output: 'completion_state: \n' }).completionState).toBe('incomplete');
  });

  it('cannot claim success for a run that did not complete', () => {
    // A recovery report written for an aborted worker said it "completed the task
    // successfully"; success is what the runtime observed, not what a report says.
    expect(
      contract({ terminalStatus: 'error', completionState: 'verified_success' }).completionState,
    ).toBe('incomplete');
  });
});

describe('resolveSubAgentRunOutput for a worker that answered directly', () => {
  const provider: LlmProviderConfig = {
    id: 'provider-1',
    name: 'Provider',
    kind: 'remote',
    baseUrl: 'https://example.test/v1',
    apiKey: '',
    model: 'model-1',
    enabled: true,
  };

  it('reports the live direct answer as delivered without a finalization pass', async () => {
    const onFinalizationStart = jest.fn();
    const resolved = await resolveSubAgentRunOutput({
      status: 'completed',
      terminalDisposition: 'final_candidate',
      provider,
      model: provider.model,
      systemPrompt: 'Worker system prompt',
      currentTaskPrompt: `Return exactly this output and nothing else: ${ANSWER}`,
      outputText: ANSWER,
      lastNonEmptyContent: ANSWER,
      finalNonEmptyContent: ANSWER,
      lastSubstantiveToolResult: '',
      toolsUsed: [],
      toolResultPreviews: [],
      transcriptMessages: [],
      iterations: 1,
      startedAt: Date.now(),
      timeoutMs: 60_000,
      outputTruncation: 20_000,
      maxToolResultPreviewChars: 1_000,
      finalizationMaxTranscriptMessages: 12,
      finalizationMessageCharLimit: 1_800,
      finalizationToolContentCharLimit: 2_600,
      finalizationMinRemainingMs: 1_000,
      finalizationTimeoutCapMs: 10_000,
      reportUsage: jest.fn(),
      onFinalizationStart,
      onFinalizedOutput: jest.fn(),
    });

    expect(resolved).toEqual({ output: ANSWER, completionState: 'verified_success' });
    expect(onFinalizationStart).not.toHaveBeenCalled();
  });
});

describe('the supervisor goal', () => {
  const goal = createGoal({
    id: 'worker-task',
    title: 'Delegate worker-task',
    status: 'active',
    owner: 'delegated-worker',
    requiredCapabilities: ['coordinate'],
    successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
    completionPolicy: 'blocking',
    now: 1,
  });
  const run = { controlGraph: { goals: [goal] } as unknown as AgentRunControlGraphState };

  function workerEvidence(completionState: SubAgentSnapshot['completionState']) {
    const agent = {
      sessionId: 'sub-1',
      name: 'worker-task',
      workstreamId: 'worker-task',
      status: 'completed',
      output: ANSWER,
      iterations: 1,
      toolsUsed: [],
      completionState,
    } as unknown as SubAgentSnapshot;
    return buildSubAgentTerminalControlGraphEvents({ run, agent, event: 'completed', timestamp: 2 })
      .filter((event) => event.type === 'GOAL_EVIDENCE_ADDED')
      .map((event) => (event as { evidence: string }).evidence);
  }

  it('receives worker evidence from a delivered answer', () => {
    expect(workerEvidence('verified_success')).toEqual([
      `worker:worker-task:${ANSWER}\n\nIterations: 1.`,
    ]);
  });

  it('received none when the answer carried no completion state', () => {
    expect(workerEvidence(undefined)).toEqual([]);
  });
});
