// ---------------------------------------------------------------------------
// Tests - Orchestrator: a run dispatches its first mobile_ui_action call
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  executeTool,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { addConversation } from '../../helpers/chatConversationFixtures';

describe('Orchestrator mobile controller dispatch', () => {
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

  it('dispatches the first mobile_ui_action call of a run', async () => {
    useSettingsStore.setState({ developerModeEnabled: true });
    const conversationId = addConversation('openai', 'You are helpful');

    (executeTool as jest.Mock).mockResolvedValueOnce({
      status: 'completed',
      content: JSON.stringify({ status: 'ok' }),
    });

    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator(
        [
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc1',
              name: 'mobile_ui_action',
              arguments: '{"kind":"wait","durationMs":500}',
            },
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

    expect(executeTool).toHaveBeenCalledWith(
      'mobile_ui_action',
      expect.any(String),
      conversationId,
      expect.any(Object),
    );
  });
});
