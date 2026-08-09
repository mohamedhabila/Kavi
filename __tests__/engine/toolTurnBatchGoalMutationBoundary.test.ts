import { executeAgentControlGraphToolBatch } from '../../src/engine/graph/toolTurnBatchExecution';
import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import { resolveToolEffectCompletionRequirement } from '../../src/engine/toolExecution/toolEffectCompletionContract';
import { buildToolResultMessage } from '../../src/engine/toolExecution/toolExecutionMessages';
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import { createParams, writeFileTool } from './helpers/toolTurnBatch';

jest.mock('../../src/engine/toolExecution/toolCallLifecycle', () => ({
  executeToolCallLifecycle: jest.fn(),
  isDeferredToolExecutionLifecycleResult: (result: unknown) =>
    Boolean(result && typeof result === 'object' && 'deferredHandoff' in result),
}));

const mockedExecuteToolCallLifecycle = jest.mocked(executeToolCallLifecycle);

describe('an effect batched with a goal mutation', () => {
  beforeEach(() => {
    mockedExecuteToolCallLifecycle.mockReset();
  });

  // The rule here used to be blanket: any effect batched with any goal mutation was
  // refused, even when the effect's admitting goal was already committed and the mutation
  // was unrelated to it. Traced on-device, that cost a full wasted round-trip — the model
  // batched update_goals with the write it admitted, was refused, and re-sent the
  // identical call on the next iteration, where it succeeded. Admission is now decided
  // against the graph as it will stand once the batch's own mutations commit.
  it('runs an effect the committed graph already admits, despite a mutation in the batch', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      const blocked = params.workflowToolCallBlocker(params.tc.name, params.tc.arguments);
      return {
        toolCallId: params.tc.id,
        effectiveToolName: params.tc.name,
        result: blocked ?? '{}',
        toolMessage: buildToolResultMessage({
          idPrefix: 'tool',
          toolCallId: params.tc.id,
          content: blocked ?? '{}',
          toolCall: {
            id: params.tc.id,
            name: params.tc.name,
            arguments: params.tc.arguments,
            status: blocked ? 'failed' : 'completed',
          },
          isError: Boolean(blocked),
        }),
      };
    });
    const argumentsText = '{"path":"reports/final.md","content":"done"}';
    const requirement = await resolveToolEffectCompletionRequirement({
      toolName: 'write_file',
      argumentsText,
    });
    if (requirement.kind !== 'effectful') {
      throw new Error('write_file must have a code-owned effect completion contract');
    }

    const outcomes = await executeAgentControlGraphToolBatch(
      createParams({
        executableToolCalls: [
          { id: 'tc-goal', name: GOAL_BOOTSTRAP_TOOL_NAME, arguments: '{"action":"create"}' },
          { id: 'tc-write', name: 'write_file', arguments: argumentsText },
        ],
        groundedRequestScopedTools: [
          {
            name: GOAL_BOOTSTRAP_TOOL_NAME,
            description: 'Update graph goals.',
            input_schema: { type: 'object', properties: {} },
          },
          writeFileTool,
        ],
        availableToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'write_file']),
        controlGraphGoals: [
          {
            id: 'g-write',
            title: 'Write final report',
            status: 'active',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: [],
            successCriteria: [requirement.serializedCriterion],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );

    // The write's goal predates the batch and the mutation does not touch it, so there is
    // no ordering dependency to protect and the write proceeds.
    expect(JSON.parse(outcomes[1]?.toolMessage.content ?? '{}')).not.toMatchObject({
      code: 'goal_mutation_boundary',
    });
  });

  it('still refuses an effect no goal admits, committed or projected', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (params: any) => {
      const blocked = params.workflowToolCallBlocker(params.tc.name, params.tc.arguments);
      return {
        toolCallId: params.tc.id,
        effectiveToolName: params.tc.name,
        result: blocked ?? '{}',
        toolMessage: buildToolResultMessage({
          idPrefix: 'tool',
          toolCallId: params.tc.id,
          content: blocked ?? '{}',
          toolCall: {
            id: params.tc.id,
            name: params.tc.name,
            arguments: params.tc.arguments,
            status: blocked ? 'failed' : 'completed',
          },
          isError: Boolean(blocked),
        }),
      };
    });

    const outcomes = await executeAgentControlGraphToolBatch(
      createParams({
        executableToolCalls: [
          { id: 'tc-goal', name: GOAL_BOOTSTRAP_TOOL_NAME, arguments: '{"action":"create"}' },
          {
            id: 'tc-write',
            name: 'write_file',
            arguments: '{"path":"reports/final.md","content":"done"}',
          },
        ],
        groundedRequestScopedTools: [
          {
            name: GOAL_BOOTSTRAP_TOOL_NAME,
            description: 'Update graph goals.',
            input_schema: { type: 'object', properties: {} },
          },
          writeFileTool,
        ],
        availableToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'write_file']),
        // No goal carries this write's completion criterion, and the batch's mutation
        // is invalid so it projects nothing.
        controlGraphGoals: [],
      }),
    );

    expect(JSON.parse(outcomes[1]?.toolMessage.content ?? '{}')).toMatchObject({
      code: 'goal_mutation_boundary',
      tool: 'write_file',
    });
  });
});
