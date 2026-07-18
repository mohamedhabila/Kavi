import { admitMobileControllerRuntime } from '../../src/engine/mobileController/runtimeBinding';
import { executeMobileControllerTool } from '../../src/engine/mobileController/toolExecution';
import { isMobileControllerDeferredExecution } from '../../src/engine/mobileController/runtimeExecution';
import { buildMobileControllerPublishedHandoff } from '../../src/engine/mobileController/publication';
import type { LlmProviderConfig } from '../../src/types/provider';
import { createPersistedMobileControllerHandoffFixture } from '../helpers/mobileControllerHandoffFixture';

const CAPABILITY = Object.freeze({
  version: 1 as const,
  controllerId: 'android-controller-1',
  controllerContractVersion: 1,
  capabilityDigest: `sha256:${'a'.repeat(64)}` as const,
  policyAdmissionDigest: `sha256:${'b'.repeat(64)}` as const,
  environmentClass: 'sandbox' as const,
  supportedActionKinds: ['activate', 'set_text'] as const,
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

function provider(capabilities = { vision: true, tools: true, fileInput: true }): LlmProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider',
    baseUrl: 'https://provider.invalid',
    apiKey: 'test-key',
    model: 'model-1',
    enabled: true,
    modelCapabilities: { 'model-1': capabilities },
  };
}

function port(overrides: Record<string, unknown> = {}) {
  return {
    capability: CAPABILITY,
    currentObservation: OBSERVATION,
    persistGraphState: jest.fn().mockResolvedValue(undefined),
    publishHandoff: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('mobile controller runtime binding', () => {
  it('admits a validated vision/tool model and narrows its tool schema', () => {
    const admission = admitMobileControllerRuntime({
      port: port(),
      provider: provider(),
      model: 'model-1',
    });

    expect(admission.kind).toBe('admitted');
    if (admission.kind !== 'admitted') throw new Error(admission.reason);
    expect(admission.runtime.toolDefinition).toMatchObject({
      name: 'mobile_ui_action',
      input_schema: {
        properties: { kind: { enum: ['activate', 'set_text'] } },
      },
    });
    expect(admission.runtime.execution).toEqual({
      capability: expect.objectContaining({ controllerId: 'android-controller-1' }),
      currentObservation: OBSERVATION,
    });
    expect(Object.isFrozen(admission.runtime)).toBe(true);
    expect(Object.isFrozen(admission.runtime.execution)).toBe(true);
  });

  it.each([
    ['invalid port', port({ publishHandoff: undefined }), 'port_invalid'],
    [
      'invalid observation image',
      port({
        currentObservationImage: {
          id: 'screen-1',
          type: 'file',
          uri: 'inline://screen.png',
          name: 'screen.png',
          mimeType: 'image/png',
          size: 8,
        },
      }),
      'port_invalid',
    ],
    [
      'synchronous-only controller',
      port({ capability: { ...CAPABILITY, outcomeDeliveryModes: ['synchronous'] } }),
      'deferred_outcome_unsupported',
    ],
    ['model without tools', port(), 'model_tools_unsupported'],
    ['model without vision', port(), 'model_vision_unsupported'],
  ] as const)('rejects %s without exposing action authority', (_label, candidate, reason) => {
    const capabilities =
      reason === 'model_tools_unsupported'
        ? { vision: true, tools: false, fileInput: true }
        : reason === 'model_vision_unsupported'
          ? { vision: false, tools: true, fileInput: true }
          : { vision: true, tools: true, fileInput: true };

    expect(
      admitMobileControllerRuntime({ port: candidate, provider: provider(capabilities), model: 'model-1' }),
    ).toEqual({ kind: 'rejected', reason });
  });

  it('builds a branded deferred execution only for the bound observation', async () => {
    const admission = admitMobileControllerRuntime({
      port: port(),
      provider: provider(),
      model: 'model-1',
    });
    if (admission.kind !== 'admitted') throw new Error(admission.reason);

    const execution = await executeMobileControllerTool(
      JSON.stringify({
        kind: 'activate',
        target: {
          kind: 'coordinate',
          observationId: OBSERVATION.observationId,
          x: 500,
          y: 500,
        },
      }),
      admission.runtime.execution,
    );

    expect(isMobileControllerDeferredExecution(execution)).toBe(true);
    expect(execution).toMatchObject({
      kind: 'mobile_controller_handoff_requested',
      beforeObservation: OBSERVATION,
    });

    const stale = await executeMobileControllerTool(
      JSON.stringify({
        kind: 'activate',
        target: { kind: 'coordinate', observationId: 'stale', x: 500, y: 500 },
      }),
      admission.runtime.execution,
    );
    expect(stale).toMatchObject({ status: 'failed' });
    expect(JSON.parse('content' in stale ? stale.content : '{}')).toMatchObject({
      code: 'action_invalid',
      retryable: true,
      repair: {
        currentObservationId: OBSERVATION.observationId,
        normalizedCoordinateRange: { minimum: 0, maximum: 999 },
      },
    });
  });

  it('publishes only the bounded host request and excludes the claim token', () => {
    const persisted = createPersistedMobileControllerHandoffFixture();
    const owner = { conversationId: 'conversation-1', agentRunId: 'agent-run-1' };
    const publication = buildMobileControllerPublishedHandoff(persisted, owner);

    expect(publication).toEqual({
      version: 1,
      owner,
      handoff: persisted.handoffRef,
      action: persisted.handoff.action,
      beforeObservation: persisted.handoff.beforeObservation,
      createdAt: persisted.handoff.createdAt,
    });
    expect(JSON.stringify(publication)).not.toContain('claimToken');
    expect(Object.isFrozen(publication)).toBe(true);
    expect(Object.isFrozen(publication?.action)).toBe(true);
    expect(
      buildMobileControllerPublishedHandoff({
        ...persisted,
        handle: { ...persisted.handle, status: 'running' },
      }, owner),
    ).toBeNull();
  });
});
