import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { buildEffectCompletionCriterion } from '../../src/engine/goals/effectCompletionEvidence';
import { CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER } from '../../src/engine/goals/types';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import {
  applyGoalGraphEvents,
  buildBaseParams,
  createGoal,
  createToolMessage,
  tool,
} from '../helpers/toolExecutionOutcomeHarness';

describe('tool execution outcome resolution', () => {

  it('retires a code-owned effect guard after a definitive failed receipt', async () => {
    const params = buildBaseParams();
    const requestDigest = `sha256:${'9'.repeat(64)}` as const;
    const receipt: ToolEffectReceipt = {
      version: 2,
      receiptId: `ter_${'9'.repeat(32)}`,
      toolCallId: 'tc-memory-failed',
      toolName: 'memory_remember',
      executionRunId: 'execution-run-1',
      contractIdentity: {
        kind: 'code_owned',
        version: 1,
        toolName: 'memory_remember',
        schemaDigest: `sha256:${'9'.repeat(64)}`,
        capabilityContractDigest: `sha256:${'9'.repeat(64)}`,
        workflowContractDigest: `sha256:${'9'.repeat(64)}`,
        effectContractDigest: `sha256:${'9'.repeat(64)}`,
        executionPolicyDigest: `sha256:${'9'.repeat(64)}`,
      },
      transportState: 'returned',
      effectKind: 'memory.write',
      effectState: 'failed',
      verificationState: 'unverified',
      requestDigest,
      resultDigest: `sha256:${'a'.repeat(64)}`,
      recordedAt: 1,
    };
    const criterion = buildEffectCompletionCriterion({
      effectKind: 'memory.write',
      requestDigest,
      resource: { kind: 'memory_fact', id: '*' },
      verificationState: 'verified',
    });
    let graph = {
      goals: [
        createGoal({
          id: 'effect-memory-write',
          title: 'Verify memory_remember effect',
          status: 'active',
          owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
          completionPolicy: 'blocking',
          successCriteria: [criterion],
        }),
      ],
    };
    params.getGraphSnapshot = jest.fn(() => graph);
    params.applyGraphEvents = jest.fn((events) => {
      graph = applyGoalGraphEvents(graph, events);
    });
    params.groundedRequestScopedTools = [
      tool({
        name: 'memory_remember',
        contract: {
          capabilities: ['write'],
          resourceKinds: ['memory'],
        },
      }),
    ];
    params.executableToolCalls = [
      {
        name: 'memory_remember',
        arguments: '{"semanticEvidence":{}}',
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-memory-failed',
        toolMessage: createToolMessage({
          id: 'tc-memory-failed',
          name: 'memory_remember',
          content: '{"status":"rejected","code":"grounding_required"}',
          isError: true,
        }),
        effectReceipt: receipt,
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(graph.goals).toEqual([]);
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'GOALS_UPDATED',
        reason: 'effect_completion_contract:terminal_failed_retired',
        projectToMemoryTasks: false,
      }),
    ]);
    expect(params.recordPostToolFinalTextDirective).toHaveBeenCalledWith(
      expect.objectContaining({
      }),
    );
  });

  it('finalizes yielded tool turns through the graph terminal event', async () => {
    const params = buildBaseParams();
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc3',
        toolMessage: createToolMessage({
          id: 'tc3',
          name: 'sessions_wait',
          content: '{"status":"checkpointed"}',
        }),
        yieldedMessage: 'Checkpoint now',
      },
    ];

    const result = await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'finalized',
      }),
    );
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'YIELDED',
          reason: 'tool_yielded',
        },
        content: 'Checkpoint now',
        sessionEndReason: 'yielded',
      }),
    );
    expect(params.onStateChange).not.toHaveBeenCalledWith('thinking');
  });
});
