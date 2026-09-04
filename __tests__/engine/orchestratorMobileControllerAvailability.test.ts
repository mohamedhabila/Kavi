import {
  makeCallbacks,
  makeMsg,
  makeStream,
  mockStreamMessage,
  provider,
  resetOrchestratorToolFilterHarness,
  setMockDeveloperModeEnabled,
} from './helpers/orchestratorToolFilterHarness';
import { runOrchestrator } from '../../src/engine/orchestrator';

const CAPABILITY = Object.freeze({
  version: 1 as const,
  controllerId: 'android-controller-1',
  controllerContractVersion: 1,
  capabilityDigest: `sha256:${'a'.repeat(64)}` as const,
  policyAdmissionDigest: `sha256:${'b'.repeat(64)}` as const,
  environmentClass: 'sandbox' as const,
  supportedActionKinds: ['activate', 'input_text'] as const,
  allowedAppIds: [] as const,
  observationEvidence: ['screenshot', 'window_identity'] as const,
  outcomeDeliveryModes: ['deferred'] as const,
  normalizedCoordinateScale: 1_000,
  maxPendingActions: 1 as const,
  maxPayloadBytes: 16_384,
  timeoutMs: 10_000,
});

const OBSERVATION = Object.freeze({
  observationId: 'observation-before-1',
  digest: `sha256:${'c'.repeat(64)}` as const,
  appId: 'notes',
  windowId: 'editor',
});

function mobileControllerPort() {
  return {
    capability: CAPABILITY,
    currentObservation: OBSERVATION,
    persistGraphState: jest.fn().mockResolvedValue(undefined),
    publishHandoff: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  resetOrchestratorToolFilterHarness();
});

describe('orchestrator mobile controller availability', () => {
  it('exposes the narrowed action tool only for an admitted runtime capability', async () => {
    // mobile_ui_action is gated behind developer mode, like the other device/workspace
    // control tools; this test exercises the mobile controller's own admission behavior,
    // so it opts in explicitly rather than exercising the (separately tested) default gate.
    setMockDeveloperModeEnabled(true);
    mockStreamMessage.mockReturnValueOnce(
      makeStream(
        [
          { type: 'token', content: 'Ready.' },
          { type: 'done', content: 'Ready.' },
        ],
        'text',
      ),
    );

    await runOrchestrator(
      {
        provider: {
          ...provider,
          modelCapabilities: {
            'gpt-test': { vision: true, tools: true, fileInput: true },
          },
        },
        model: 'gpt-test',
        conversationId: 'conv-mobile-controller-admitted',
        agentRunId: 'agent-run-1',
        systemPrompt: 'Test',
        messages: [makeMsg('user', 'Continue the task on the current mobile screen')],
        explicitToolSurfaceToolNames: ['mobile_ui_action'],
        toolFilter: (name) => name === 'mobile_ui_action',
        mobileController: mobileControllerPort(),
      },
      makeCallbacks(),
    );

    expect(mockStreamMessage.mock.calls[0][1].tools).toEqual([
      expect.objectContaining({
        name: 'mobile_ui_action',
        input_schema: expect.objectContaining({
          properties: expect.objectContaining({
            kind: { type: 'string', enum: ['activate', 'input_text'] },
          }),
        }),
      }),
    ]);
  });

  it('keeps chat available without mobile authority for an incompatible selected model', async () => {
    mockStreamMessage.mockReturnValueOnce(
      makeStream(
        [
          { type: 'token', content: 'I can still help in chat.' },
          { type: 'done', content: 'I can still help in chat.' },
        ],
        'text',
      ),
    );
    const callbacks = makeCallbacks();

    await runOrchestrator(
      {
        provider: {
          ...provider,
          modelCapabilities: {
            'gpt-test': { vision: false, tools: true, fileInput: true },
          },
        },
        model: 'gpt-test',
        conversationId: 'conv-mobile-controller-rejected',
        agentRunId: 'agent-run-1',
        systemPrompt: 'Test',
        messages: [makeMsg('user', 'Help me with this task')],
        explicitToolSurfaceToolNames: ['mobile_ui_action'],
        toolFilter: (name) => name === 'mobile_ui_action',
        mobileController: mobileControllerPort(),
      },
      callbacks,
    );

    expect(mockStreamMessage.mock.calls[0][1].tools).toEqual([]);
    expect(callbacks.onAssistantMessage).toHaveBeenCalledWith(
      'I can still help in chat.',
      [],
      undefined,
      expect.objectContaining({ kind: 'final' }),
    );
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('does not expose mobile authority without a durable AgentRun owner', async () => {
    mockStreamMessage.mockReturnValueOnce(
      makeStream(
        [
          { type: 'token', content: 'Chat remains available.' },
          { type: 'done', content: 'Chat remains available.' },
        ],
        'text',
      ),
    );

    await runOrchestrator(
      {
        provider: {
          ...provider,
          modelCapabilities: {
            'gpt-test': { vision: true, tools: true, fileInput: true },
          },
        },
        model: 'gpt-test',
        conversationId: 'conv-mobile-controller-unowned',
        systemPrompt: 'Test',
        messages: [makeMsg('user', 'Describe what is on the current screen')],
        explicitToolSurfaceToolNames: ['mobile_ui_action'],
        toolFilter: (name) => name === 'mobile_ui_action',
        mobileController: mobileControllerPort(),
      },
      makeCallbacks(),
    );

    expect(mockStreamMessage.mock.calls[0][1].tools).toEqual([]);
  });
});
