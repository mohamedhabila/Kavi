import { runOrchestrator } from '../../src/engine/orchestrator';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import { resolveForegroundInterruptedResponseOutcome } from '../../src/engine/graph/foregroundRun/foregroundInterruptedResponse';
import { appSteeringQueue } from '../../src/engine/graph/foregroundRun/steeringQueue';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { __resetOnDeviceGuardsForTests } from '../../src/services/memory/onDeviceGuards';
import {
  createConversation,
  createExecutionContext,
  createProvider,
  createReadyPreflightResult,
} from '../helpers/foregroundRunExecutionContextHarness';

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/preflight', () => ({
  resolveForegroundRunPreflight: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/foregroundInterruptedResponse', () => ({
  resolveForegroundInterruptedResponseOutcome: jest.fn(),
}));

jest.mock('../../src/services/memory/policy', () => ({
  ...jest.requireActual('../../src/services/memory/policy'),
  canWriteLongTermMemory: () => true,
}));

const mockedRunOrchestrator = runOrchestrator as jest.MockedFunction<typeof runOrchestrator>;
const mockedResolveForegroundRunPreflight = resolveForegroundRunPreflight as jest.MockedFunction<
  typeof resolveForegroundRunPreflight
>;
const mockedResolveForegroundInterruptedResponseOutcome =
  resolveForegroundInterruptedResponseOutcome as jest.MockedFunction<
    typeof resolveForegroundInterruptedResponseOutcome
  >;

// A message sent while the run works is handed to the run's next model step. It must
// land after the tool results it follows and before the assistant message that reads it,
// so it never arrives while the first step is still streaming into its reserved message.

describe('foreground run steering', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    __resetOnDeviceGuardsForTests();
    mockedResolveForegroundInterruptedResponseOutcome.mockResolvedValue({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'stream closed',
    });
  });

  afterEach(() => {
    appSteeringQueue.clear('target-conversation');
  });

  it('delivers a steer after a tool-calling step and before the next answer', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('provider', 'model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
      persistAddedMessages: true,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider, providerWithApiKey: provider }),
    );
    const observed: { runId?: string; beforeToolStep?: unknown; afterToolStep?: unknown } = {};
    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      observed.runId = options.executionRunId;
      appSteeringQueue.enqueue({
        id: 'steer-1',
        conversationId: conversation.id,
        targetRunId: options.executionRunId!,
        text: 'Make it vegetarian.',
        enqueuedAt: 5,
      });
      observed.beforeToolStep = callbacks.takeSteeringMessages?.();
      callbacks.onAssistantMessage(
        '',
        [{ id: 'call-1', name: 'web_search', arguments: '{}', status: 'pending' }],
        undefined,
        { kind: 'intermediate', completionStatus: 'complete', finishReason: 'tool_calls' },
      );
      observed.afterToolStep = callbacks.takeSteeringMessages?.();
      callbacks.onToken('Here is a vegetarian plan.');
      callbacks.onAssistantMessage('Here is a vegetarian plan.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });
      callbacks.onAgentControlGraphStateChange?.(
        createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
      );
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(observed.beforeToolStep).toEqual([]);
    const steer = {
      id: 'steer-1',
      role: 'user',
      content: 'Make it vegetarian.',
      steerOfRunId: observed.runId,
    };
    expect(observed.afterToolStep).toEqual([expect.objectContaining(steer)]);
    const messages = context.getCurrentConversation().messages;
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Continue this conversation.'],
      ['assistant', ''],
      ['user', 'Make it vegetarian.'],
      ['assistant', 'Here is a vegetarian plan.'],
    ]);
    expect(messages[2]).toEqual(expect.objectContaining(steer));
    expect(appSteeringQueue.get(conversation.id)).toEqual([]);
  });
});
