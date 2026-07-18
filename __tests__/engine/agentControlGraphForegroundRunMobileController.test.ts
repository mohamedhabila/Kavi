import { runOrchestrator } from '../../src/engine/orchestrator';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import { resolveForegroundInterruptedResponseOutcome } from '../../src/engine/graph/foregroundRun/foregroundInterruptedResponse';
import { buildMobileControllerPublishedHandoff } from '../../src/engine/mobileController/publication';
import { __resetOnDeviceGuardsForTests } from '../../src/services/memory/onDeviceGuards';
import {
  createConversation,
  createExecutionContext,
  createProvider,
  createReadyPreflightResult,
} from '../helpers/foregroundRunExecutionContextHarness';
import { createPersistedMobileControllerHandoffFixture } from '../helpers/mobileControllerHandoffFixture';

const mockCanWriteLongTermMemory = jest.fn();

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
  canWriteLongTermMemory: (...args: unknown[]) => mockCanWriteLongTermMemory(...args),
}));

const mockedRunOrchestrator = runOrchestrator as jest.MockedFunction<typeof runOrchestrator>;
const mockedResolveForegroundRunPreflight = resolveForegroundRunPreflight as jest.MockedFunction<
  typeof resolveForegroundRunPreflight
>;
const mockedResolveForegroundInterruptedResponseOutcome =
  resolveForegroundInterruptedResponseOutcome as jest.MockedFunction<
    typeof resolveForegroundInterruptedResponseOutcome
  >;

describe('foreground mobile controller binding', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockCanWriteLongTermMemory.mockReturnValue(true);
    __resetOnDeviceGuardsForTests();
    mockedResolveForegroundInterruptedResponseOutcome.mockResolvedValue({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'stream closed',
    });
  });

  it('binds the host controller with a foreground persistence barrier', async () => {
    const conversation = createConversation({ mode: 'agentic' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    const publication = buildMobileControllerPublishedHandoff(
      createPersistedMobileControllerHandoffFixture(),
      { conversationId: conversation.id, agentRunId: 'agent-run-1' },
    );
    if (!publication) throw new Error('expected mobile controller publication fixture');
    const publishHandoff = jest.fn().mockResolvedValue(undefined);
    let flushCountBeforeControllerPersistence = -1;
    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      if (!options.mobileController) throw new Error('expected mobile controller runtime port');
      flushCountBeforeControllerPersistence = context.durability.flushChatState.mock.calls.length;
      await options.mobileController.persistGraphState();
      await options.mobileController.publishHandoff(publication);
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    await executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
      options: {
        mobileController: {
          capability: {
            version: 1,
            controllerId: 'android-controller-1',
            controllerContractVersion: 1,
            capabilityDigest: `sha256:${'a'.repeat(64)}`,
            policyAdmissionDigest: `sha256:${'b'.repeat(64)}`,
            environmentClass: 'sandbox',
            supportedActionKinds: ['activate'],
            allowedAppIds: [],
            observationEvidence: ['screenshot', 'window_identity'],
            outcomeDeliveryModes: ['deferred'],
            normalizedCoordinateScale: 1_000,
            maxPendingActions: 1,
            maxPayloadBytes: 16_384,
            timeoutMs: 10_000,
          },
          currentObservation: {
            observationId: 'observation-before-1',
            digest: `sha256:${'c'.repeat(64)}`,
            appId: 'notes',
            windowId: 'editor',
          },
          publishHandoff,
        },
      },
    });

    expect(flushCountBeforeControllerPersistence).toBeGreaterThanOrEqual(0);
    expect(context.durability.flushChatState.mock.calls.length).toBeGreaterThan(
      flushCountBeforeControllerPersistence,
    );
    expect(
      context.durability.flushChatState.mock.invocationCallOrder[
        flushCountBeforeControllerPersistence
      ],
    ).toBeLessThan(publishHandoff.mock.invocationCallOrder[0]);
    expect(publishHandoff).toHaveBeenCalledWith(publication);
  });
});
