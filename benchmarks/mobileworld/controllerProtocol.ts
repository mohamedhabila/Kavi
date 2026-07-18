import type {
  MobileControllerAction,
  MobileControllerCapability,
  MobileControllerObservationRef,
  MobileControllerOutcome,
  MobileControllerTarget,
} from '../../src/engine/mobileController/contracts';
import type { MobileControllerPublishedHandoff } from '../../src/engine/mobileController/publication';
import {
  qualifyMobileControllerCapability,
  qualifyMobileControllerObservationRef,
  qualifyMobileControllerOutcome,
} from '../../src/engine/mobileController/validation';
import type { ToolEffectDigest } from '../../src/types/toolEffectReceipt';
import { sha256HexUtf8Async } from '../../src/utils/sha256Async';

export const MOBILEWORLD_COORDINATE_SCALE = 1_000;
const MOBILEWORLD_CONTROLLER_ID = 'mobileworld-android-sandbox';
const MOBILEWORLD_ACTION_KINDS = [
  'activate',
  'double_tap',
  'long_press',
  'drag',
  'set_text',
  'keyboard_enter',
  'back',
  'home',
  'open_app',
  'scroll',
  'wait',
] as const;

export type MobileWorldControllerAction =
  | Readonly<{ action_type: 'click' | 'double_tap' | 'long_press'; coordinate: [number, number] }>
  | Readonly<{
      action_type: 'drag';
      start_coordinate: [number, number];
      end_coordinate: [number, number];
    }>
  | Readonly<{ action_type: 'input_text'; text: string }>
  | Readonly<{ action_type: 'keyboard_enter' | 'navigate_back' | 'navigate_home' | 'wait' }>
  | Readonly<{ action_type: 'open_app'; app_name: string }>
  | Readonly<{ action_type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right' }>;

async function digest(value: string): Promise<ToolEffectDigest> {
  return `sha256:${await sha256HexUtf8Async(value)}`;
}

function controllerAppIdentifiers(values: ReadonlyArray<string>): string[] {
  const normalized = values.map((value) => value.trim()).sort();
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    normalized.some((value) => !value || value.length > 100) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error('mobileworld_controller_app_identifiers_invalid');
  }
  return normalized;
}

export async function buildMobileWorldControllerCapability(
  appIdentifiers: ReadonlyArray<string>,
): Promise<MobileControllerCapability> {
  const allowedAppIds = controllerAppIdentifiers(appIdentifiers);
  const policyAdmissionDigest = await digest('mobileworld:android:sandbox:policy:v1');
  const unsignedCapability = {
    version: 1 as const,
    controllerId: MOBILEWORLD_CONTROLLER_ID,
    controllerContractVersion: 1,
    policyAdmissionDigest,
    environmentClass: 'sandbox' as const,
    supportedActionKinds: MOBILEWORLD_ACTION_KINDS,
    allowedAppIds,
    observationEvidence: ['screenshot', 'window_identity'] as const,
    outcomeDeliveryModes: ['deferred'] as const,
    normalizedCoordinateScale: MOBILEWORLD_COORDINATE_SCALE,
    maxPendingActions: 1 as const,
    maxPayloadBytes: 65_536,
    timeoutMs: 300_000,
  };
  const capability = qualifyMobileControllerCapability({
    ...unsignedCapability,
    capabilityDigest: await digest(JSON.stringify(unsignedCapability)),
  });
  if (!capability) throw new Error('mobileworld_controller_capability_invalid');
  return capability;
}

export function buildMobileWorldObservationRef(input: {
  observationId: string;
  screenshotDigest: ToolEffectDigest;
  appId?: string;
  windowId?: string;
}): MobileControllerObservationRef {
  const observation = qualifyMobileControllerObservationRef({
    observationId: input.observationId,
    digest: input.screenshotDigest,
    ...(input.appId ? { appId: input.appId } : {}),
    ...(input.windowId ? { windowId: input.windowId } : {}),
  });
  if (!observation) throw new Error('mobileworld_controller_observation_invalid');
  return observation;
}

function coordinateTarget(target: MobileControllerTarget): [number, number] {
  if (target.kind !== 'coordinate') {
    throw new Error('mobileworld_controller_element_target_unsupported');
  }
  return [target.x, target.y];
}

export function mapMobileControllerActionToMobileWorld(
  action: MobileControllerAction,
): MobileWorldControllerAction {
  switch (action.kind) {
    case 'activate':
      return { action_type: 'click', coordinate: coordinateTarget(action.target) };
    case 'double_tap':
      return { action_type: 'double_tap', coordinate: coordinateTarget(action.target) };
    case 'long_press':
      return { action_type: 'long_press', coordinate: coordinateTarget(action.target) };
    case 'drag':
      return {
        action_type: 'drag',
        start_coordinate: [action.start.x, action.start.y],
        end_coordinate: [action.end.x, action.end.y],
      };
    case 'set_text':
      return { action_type: 'input_text', text: action.text };
    case 'keyboard_enter':
      return { action_type: 'keyboard_enter' };
    case 'back':
      return { action_type: 'navigate_back' };
    case 'home':
      return { action_type: 'navigate_home' };
    case 'open_app':
      return { action_type: 'open_app', app_name: action.appId };
    case 'scroll':
      return { action_type: 'scroll', direction: action.direction };
    case 'wait':
      return { action_type: 'wait' };
  }
}

export function buildMobileWorldControllerOutcome(input: {
  outcomeId: string;
  publication: MobileControllerPublishedHandoff;
  afterObservation: MobileControllerObservationRef;
  observableDelta: 'changed' | 'unchanged';
  observedAt: number;
  stabilization?: Readonly<{ durationMs: number; sampleCount: number }>;
}): MobileControllerOutcome {
  const handoff = input.publication.handoff;
  const outcome = qualifyMobileControllerOutcome({
    version: 1,
    outcomeId: input.outcomeId,
    handoffId: handoff.handoffId,
    controllerId: handoff.controllerId,
    capabilityDigest: handoff.capabilityDigest,
    correlation: {
      runId: handoff.effectRunId,
      effectId: handoff.effectId,
      executionRunId: handoff.executionRunId,
      toolCallId: handoff.toolCallId,
    },
    executionState: 'completed',
    effectState: 'applied',
    verificationState: 'acknowledged',
    observableDelta: input.observableDelta,
    reasonCode: 'completed',
    beforeObservationId: handoff.beforeObservationId,
    afterObservation: input.afterObservation,
    ...(input.stabilization ? { stabilization: input.stabilization } : {}),
    observedAt: input.observedAt,
  });
  if (!outcome) throw new Error('mobileworld_controller_outcome_invalid');
  return outcome;
}
