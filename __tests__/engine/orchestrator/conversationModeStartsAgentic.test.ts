// ---------------------------------------------------------------------------
// Tests - Orchestrator: conversation-mode-driven tool surface and memory access
// ---------------------------------------------------------------------------
// Mode is a conversation property (Conversation.mode), not a persona flag: the
// tool surface (bootstrap.ts -> filterToolsForConversationMode) and the memory
// access mode (orchestratorRequestPreparation.ts) must both follow the
// conversation's own persisted mode via resolveConversationStartsAgentic,
// independent of whether the active persona is SuperAgent.

import {
  runOrchestrator,
  executeTool,
  memoryAccessGateway,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  getPersona,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { MOBILE_CONTROLLER_GOAL_OWNER } from '../../../src/engine/mobileController/goalAdmission';

/**
 * The real gateway hits durable memory subsystems this harness does not set up;
 * stub a well-formed success so only the `mode` argument under test matters.
 */
function mockMemoryAccessSuccess(): jest.SpyInstance {
  return jest
    .spyOn(memoryAccessGateway, 'buildUnifiedMemoryAccessContext')
    .mockImplementation(async (params: any) => ({
      boundary: {
        startIndex: 0,
        reason: 'full_history',
        similarityScore: 1,
        idleGapMs: 0,
        droppedMessageCount: 0,
      },
      scopedMessages: params.messages,
      livingMemory: null,
      consistencyBarrier: {
        outcome: 'no_job',
        durationMs: 0,
        waitedMs: 0,
        queryCount: 0,
        matchedJobCount: 0,
        queueAgeMs: null,
        initialJobStatus: null,
        finalJobStatus: null,
      },
    }));
}

describe('Orchestrator conversation mode drives tool surface and memory access', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  afterEach(() => {
    useSettingsStore.setState({ developerModeEnabled: false });
  });

  it('gives a non-SuperAgent persona in an agentic conversation the agentic tool baseline and agentic memory access', async () => {
    const conversationId = useChatStore
      .getState()
      .createConversation('openai', 'You are helpful', undefined, {
        personaId: 'default',
        mode: 'agentic',
      });

    const memoryAccessSpy = mockMemoryAccessSuccess();

    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator(
        [
          { type: 'token', content: 'Ready.' },
          { type: 'done', content: 'Ready.' },
        ],
        'text',
      ),
    );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider(),
      model: 'gpt-5.4',
      conversationId,
      personaId: 'default',
      systemPrompt: 'You are helpful',
      explicitToolSurfaceToolNames: ['sessions_spawn'],
      toolFilter: (toolName) => toolName === 'sessions_spawn',
      messages: [
        { id: 'msg1', role: 'user', content: 'Coordinate a delegated task.', timestamp: Date.now() },
      ],
    };

    await runOrchestrator(options, callbacks);

    const advertisedToolNames = (mockStreamMessage.mock.calls[0][1].tools || []).map(
      (tool: any) => tool.name,
    );
    expect(advertisedToolNames).toContain('sessions_spawn');
    expect(memoryAccessSpy).toHaveBeenCalledWith(expect.objectContaining({ mode: 'agentic' }));
  });

  it('gives a SuperAgent persona in a chitchat conversation the chitchat tool baseline and chat memory access', async () => {
    (getPersona as jest.Mock).mockImplementation((personaId: string) =>
      personaId === 'super-agent'
        ? {
            id: 'super-agent',
            name: 'SuperAgent',
            description: 'Test graph orchestrator',
            systemPrompt: 'Use the agent control graph.',
          }
        : undefined,
    );
    const conversationId = useChatStore
      .getState()
      .createConversation('openai', 'You are helpful', undefined, {
        personaId: 'super-agent',
        mode: 'chitchat',
      });

    const memoryAccessSpy = mockMemoryAccessSuccess();

    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator(
        [
          { type: 'token', content: 'Just chatting.' },
          { type: 'done', content: 'Just chatting.' },
        ],
        'text',
      ),
    );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider(),
      model: 'gpt-5.4',
      conversationId,
      personaId: 'super-agent',
      systemPrompt: 'You are helpful',
      explicitToolSurfaceToolNames: ['sessions_spawn'],
      toolFilter: (toolName) => toolName === 'sessions_spawn',
      messages: [{ id: 'msg1', role: 'user', content: 'Just say hi.', timestamp: Date.now() }],
    };

    await runOrchestrator(options, callbacks);

    const advertisedToolNames = (mockStreamMessage.mock.calls[0][1].tools || []).map(
      (tool: any) => tool.name,
    );
    expect(advertisedToolNames).not.toContain('sessions_spawn');
    expect(memoryAccessSpy).toHaveBeenCalledWith(expect.objectContaining({ mode: 'chat' }));
  });

  it('materializes the code-owned goal on the first mobile_ui_action call instead of blocking it', async () => {
    useSettingsStore.setState({ developerModeEnabled: true });
    const conversationId = useChatStore
      .getState()
      .createConversation('openai', 'You are helpful', undefined, {
        personaId: 'default',
        mode: 'agentic',
      });

    (executeTool as jest.Mock).mockResolvedValueOnce({
      status: 'completed',
      content: JSON.stringify({ status: 'ok' }),
    });

    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator(
        [
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'mobile_ui_action', arguments: '{"kind":"wait","durationMs":500}' },
          },
          { type: 'done', content: '' },
        ],
        'tool',
      ),
    );
    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator(
        [
          { type: 'token', content: 'Done.' },
          { type: 'done', content: 'Done.' },
        ],
        'text',
      ),
    );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider(),
      model: 'gpt-5.4',
      conversationId,
      agentRunId: 'agent-run-mobile-1',
      personaId: 'default',
      systemPrompt: 'You are helpful',
      explicitToolSurfaceToolNames: ['mobile_ui_action'],
      toolFilter: (toolName) => toolName === 'mobile_ui_action',
      messages: [
        { id: 'msg1', role: 'user', content: 'Wait a moment on screen.', timestamp: Date.now() },
      ],
      mobileController: {
        capability: {
          version: 1,
          controllerId: 'android-controller-1',
          controllerContractVersion: 1,
          capabilityDigest: `sha256:${'a'.repeat(64)}`,
          policyAdmissionDigest: `sha256:${'b'.repeat(64)}`,
          environmentClass: 'sandbox',
          supportedActionKinds: ['wait'],
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
        persistGraphState: jest.fn().mockResolvedValue(undefined),
        publishHandoff: jest.fn().mockResolvedValue(undefined),
      } as unknown as OrchestratorOptions['mobileController'],
    };

    await runOrchestrator(options, callbacks);

    // The call was actually dispatched, not synthetically blocked by the goal
    // admission gate: the mock only resolves once we get past the block.
    expect(executeTool).toHaveBeenCalledWith(
      'mobile_ui_action',
      expect.any(String),
      conversationId,
      expect.any(Object),
    );
    expect(JSON.stringify(mockStreamMessage.mock.calls)).not.toContain(
      'mobile_controller_goal_required',
    );

    const lastGraphState =
      callbacks.calls.onAgentControlGraphStateChange[
        callbacks.calls.onAgentControlGraphStateChange.length - 1
      ];
    expect(
      (lastGraphState.goals ?? []).some(
        (goal: any) => goal.owner === MOBILE_CONTROLLER_GOAL_OWNER,
      ),
    ).toBe(true);
  });
});
