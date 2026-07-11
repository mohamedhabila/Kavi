import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { resolveAgentControlGraphNoToolTurn } from '../../src/engine/graph/noToolTurnResolution';
import type { ToolCallRecord } from '../../src/engine/loopDetection';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';

function buildTool(
  name: string,
  contract: NonNullable<ToolDefinition['contract']>,
): ToolDefinition {
  return {
    name,
    description: `${name} workflow tool`,
    input_schema: { type: 'object', properties: {} },
    contract,
  };
}

function buildToolCall(
  name: string,
  timestamp: number,
  result: string = JSON.stringify({ status: 'ok' }),
): ToolCallRecord {
  return {
    id: `tc-${name}-${timestamp}`,
    name,
    arguments: '{}',
    timestamp,
    result,
  };
}

function buildParams(params: {
  allTools: ToolDefinition[];
  selectedTools: ToolDefinition[];
  toolCallHistory: ToolCallRecord[];
}) {
  const workingMessages: Message[] = [];
  return {
    iteration: 3,
    trackedAsyncOperations: new Map(),
    consecutivePendingAsyncNoToolTurns: 0,
    turnAssistantContent: 'final answer',
    modelTurnAssistantContent: 'final answer',
    reasoning: '',
    completion: {
      completionStatus: 'complete' as const,
      finishReason: 'stop',
    },
    controlGraph: createInitialAgentControlGraphSnapshot(),
    toolingEnabledForProvider: true,
    selectedToolCount: params.selectedTools.length,
    selectedToolNames: new Set(params.selectedTools.map((tool) => tool.name)),
    selectedTools: params.selectedTools,
    allTools: params.allTools,
    effectiveForceTextThisTurn: false,
    recoveryDirectives: {
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    },
    toolCallHistory: params.toolCallHistory,
    nextFinalizationMaxTokens: 4096,
    workingMessages,
    applyGraphEvents: jest.fn(),
    resetIncompleteFinalTextRecovery: jest.fn(),
    recordTurnDirectives: jest.fn(),
    finishWithGraphFinalCandidateEvent: jest.fn().mockResolvedValue(undefined),
    finishWithGraphTerminalEvent: jest.fn().mockResolvedValue(undefined),
    onContinueThinking: jest.fn().mockResolvedValue(undefined),
  };
}

describe('workflow continuation resolution', () => {
  const producer = buildTool('resource_find', {
    produces: [{ kind: 'resource_candidate' }],
  });
  const consumer = buildTool('resource_use', {
    consumes: [{ kind: 'resource_candidate' }],
  });

  it('does not hold a selected sibling after a registered off-surface consumer succeeded', async () => {
    const siblingConsumer = buildTool('resource_inspect', {
      consumes: [{ kind: 'resource_candidate' }],
    });
    const params = buildParams({
      allTools: [producer, consumer, siblingConsumer],
      selectedTools: [siblingConsumer],
      toolCallHistory: [
        buildToolCall(producer.name, 1),
        buildToolCall(consumer.name, 2),
      ],
    });

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.finishWithGraphFinalCandidateEvent).toHaveBeenCalledTimes(1);
    expect(params.onContinueThinking).not.toHaveBeenCalled();
  });

  it('uses execution history order when accounting for produced resources', async () => {
    const consumedParams = buildParams({
      allTools: [producer, consumer],
      selectedTools: [consumer],
      toolCallHistory: [
        buildToolCall(producer.name, 1),
        buildToolCall(consumer.name, 2),
      ],
    });
    const producedLaterParams = buildParams({
      allTools: [producer, consumer],
      selectedTools: [consumer],
      toolCallHistory: [
        buildToolCall(consumer.name, 1),
        buildToolCall(producer.name, 2),
      ],
    });

    const consumedResult = await resolveAgentControlGraphNoToolTurn(consumedParams);
    const producedLaterResult = await resolveAgentControlGraphNoToolTurn(producedLaterParams);

    expect(consumedResult).toEqual({ status: 'finalized' });
    expect(producedLaterResult).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 1,
    });
    expect(producedLaterParams.workingMessages.at(-1)?.content).toContain(consumer.name);
  });

  it('keeps a production pending when its downstream consumer failed', async () => {
    const params = buildParams({
      allTools: [producer, consumer],
      selectedTools: [consumer],
      toolCallHistory: [
        buildToolCall(producer.name, 1),
        buildToolCall(consumer.name, 2, 'Error: resource unavailable'),
      ],
    });

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 1,
    });
    expect(params.workingMessages.at(-1)?.content).toContain(consumer.name);
  });

  it('keeps a consumer-produced resource available for the next chain step', async () => {
    const transformer = buildTool('resource_inspect', {
      consumes: [{ kind: 'resource_candidate' }],
      produces: [{ kind: 'resource_detail' }],
    });
    const finalConsumer = buildTool('resource_apply', {
      consumes: [{ kind: 'resource_detail' }],
    });
    const params = buildParams({
      allTools: [producer, transformer, finalConsumer],
      selectedTools: [finalConsumer],
      toolCallHistory: [
        buildToolCall(producer.name, 1),
        buildToolCall(transformer.name, 2),
      ],
    });

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 1,
    });
    expect(params.workingMessages.at(-1)?.content).toContain(finalConsumer.name);
  });
});
