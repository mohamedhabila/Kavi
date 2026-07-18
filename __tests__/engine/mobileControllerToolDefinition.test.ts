import { buildCodeOwnedToolContractIdentity } from '../../src/engine/toolExecution/toolContractIdentity';
import { getCodeOwnedToolEffectContract } from '../../src/engine/toolExecution/toolEffectReceiptContracts';
import { resolveToolEffectPolicy } from '../../src/engine/durability/toolEffectPolicy';
import {
  buildMobileControllerToolDefinition,
  MOBILE_UI_ACTION_TOOL_DEFINITION,
} from '../../src/engine/mobileController/toolDefinition';
import { filterToolsByRuntimeAvailability } from '../../src/engine/tools/runtimeAvailability';

const capability = {
  version: 1,
  controllerId: 'android-controller-1',
  controllerContractVersion: 3,
  capabilityDigest: `sha256:${'a'.repeat(64)}`,
  policyAdmissionDigest: `sha256:${'b'.repeat(64)}`,
  environmentClass: 'sandbox',
  supportedActionKinds: ['activate', 'open_app', 'wait'],
  allowedAppIds: ['clock', 'files'],
  observationEvidence: ['screenshot', 'window_identity'],
  outcomeDeliveryModes: ['deferred'],
  normalizedCoordinateScale: 1_000,
  maxPendingActions: 1,
  maxPayloadBytes: 16_384,
  timeoutMs: 5_000,
} as const;

function availability(hasMobileController: boolean) {
  return {
    hasWorkspaceTargets: false,
    hasBrowserControllableWorkspaceTargets: false,
    hasDelegableWorkspaceTargets: false,
    hasMobileController,
  };
}

describe('mobile controller tool definition', () => {
  it('keeps the canonical tool invisible without an admitted runtime controller', () => {
    expect(
      filterToolsByRuntimeAvailability([MOBILE_UI_ACTION_TOOL_DEFINITION], availability(false)),
    ).toEqual([]);
    expect(
      filterToolsByRuntimeAvailability([MOBILE_UI_ACTION_TOOL_DEFINITION], availability(true)),
    ).toEqual([MOBILE_UI_ACTION_TOOL_DEFINITION]);
  });

  it('narrows the model schema to the exact registered capability', () => {
    const definition = buildMobileControllerToolDefinition(capability);

    expect(definition).toEqual(
      expect.objectContaining({
        name: 'mobile_ui_action',
        input_schema: expect.objectContaining({
          additionalProperties: false,
          properties: expect.objectContaining({
            kind: { type: 'string', enum: ['activate', 'open_app', 'wait'] },
            appId: { type: 'string', enum: ['clock', 'files'] },
            durationMs: { type: 'integer', minimum: 100, maximum: 5_000 },
          }),
        }),
      }),
    );
    expect(definition?.input_schema.properties).not.toHaveProperty('text');
    const target = definition?.input_schema.properties.target as Record<string, any>;
    expect(target.properties.x.maximum).toBe(1_000);
    expect(target.properties.kind.enum).toEqual(['coordinate']);
    expect(target.required).toEqual(['kind', 'observationId', 'x', 'y']);
    expect(target.properties).not.toHaveProperty('elementId');
  });

  it('advertises semantic element targets only when the controller supplies them', () => {
    const definition = buildMobileControllerToolDefinition({
      ...capability,
      observationEvidence: ['screenshot', 'accessibility_snapshot'],
    });

    const target = definition?.input_schema.properties.target as Record<string, any>;
    expect(target.properties.kind.enum).toEqual(['element', 'coordinate']);
    expect(target.properties).toHaveProperty('elementId');
  });

  it('uses a stable code-owned effect and retry contract independent of the host schema', async () => {
    expect(resolveToolEffectPolicy('mobile_ui_action')).toEqual({
      toolName: 'mobile_ui_action',
      source: 'builtin',
      effects: ['external_run'],
      idempotency: 'not_declared',
      retryPolicy: 'reconcile_before_retry',
    });
    expect(getCodeOwnedToolEffectContract('mobile_ui_action')).toEqual({
      effectMode: 'effectful',
      effectKind: 'unknown',
      completionMode: 'operational',
      tracksExecution: true,
    });
    await expect(buildCodeOwnedToolContractIdentity('mobile_ui_action')).resolves.toEqual(
      expect.objectContaining({ kind: 'code_owned', toolName: 'mobile_ui_action' }),
    );
  });
});
