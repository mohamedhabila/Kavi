import { runOrchestrator } from '../../src/engine/orchestrator';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import { resolveForegroundInterruptedResponseOutcome } from '../../src/engine/graph/foregroundRun/foregroundInterruptedResponse';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { createTurnLatencyTimeline } from '../../src/engine/turnLatencyTimeline';
import { __resetOnDeviceGuardsForTests } from '../../src/services/memory/onDeviceGuards';
import type { AgentRunTurnLatency } from '../../src/types/agentRun';
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

function prepareReadyRun() {
  const conversation = createConversation({ mode: 'chitchat' });
  const provider = createProvider('provider', 'model');
  const context = createExecutionContext({
    conversation,
    providers: [provider],
    ensureCanonicalConversation: jest.fn(),
    recordConversationTurnMemory: jest.fn(),
  });
  mockedResolveForegroundRunPreflight.mockResolvedValue(
    createReadyPreflightResult({ conversation, provider, providerWithApiKey: provider }),
  );
  const observed: { breakdownAtBootstrap?: AgentRunTurnLatency } = {};
  mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
    observed.breakdownAtBootstrap = callbacks.onTurnLatencyMark?.('session_bootstrapped');
    callbacks.onAssistantMessage?.('Done.', [], undefined, {
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
  return { context, conversation, observed };
}

describe('foreground run turn latency stages', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    __resetOnDeviceGuardsForTests();
    mockedResolveForegroundInterruptedResponseOutcome.mockResolvedValue({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'stream closed',
    });
  });

  it('marks each foreground stage on the send timeline before the orchestrator runs', async () => {
    const { context, conversation, observed } = prepareReadyRun();
    let clock = 0;
    const latencyTimeline = createTurnLatencyTimeline(() => {
      clock += 10;
      return clock;
    });
    latencyTimeline.mark('user_message_added');

    await executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
      options: { latencyTimeline },
    });

    expect(observed.breakdownAtBootstrap).toEqual({
      user_message_added: 10,
      recovery_ready: 20,
      request_reserved: 30,
      provider_ready: 40,
      journal_active: 50,
      session_bootstrapped: 60,
    });
  });

  it('times a run started without a send timeline from the run itself', async () => {
    const { context, conversation, observed } = prepareReadyRun();

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(Object.keys(observed.breakdownAtBootstrap ?? {})).toEqual([
      'recovery_ready',
      'request_reserved',
      'provider_ready',
      'journal_active',
      'session_bootstrapped',
    ]);
  });
});
