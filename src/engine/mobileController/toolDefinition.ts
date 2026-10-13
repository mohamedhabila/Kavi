import type { ToolDefinition } from '../../types/tool';
import {
  MOBILE_CONTROLLER_ACTION_KINDS,
  MOBILE_UI_ACTION_TOOL_NAME,
  type MobileControllerActionKind,
  type MobileControllerCapability,
} from './contracts';
import { qualifyMobileControllerCapability } from './validation';

const SCROLL_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

const MOBILE_UI_ACTION_CONTRACT: NonNullable<ToolDefinition['contract']> = Object.freeze({
  runtimeRequirements: ['mobile_controller'],
  category: 'mobile_controller',
  capabilities: ['write', 'coordinate'],
  resourceKinds: ['device'],
  sideEffects: ['external_run'],
  riskHints: ['open_world'],
  riskLevel: 'high',
  prerequisites: ['runtime_mobile_controller', 'current_mobile_observation'],
  permissionPrerequisites: ['mobile_controller_policy_admission'],
  recoverableErrors: [
    'target_unavailable',
    'stale_observation',
    'observation_unavailable',
    'controller_unavailable',
  ],
  providesEvidence: [],
  workflowStages: ['mutate_remote_state', 'continue_external_execution'],
});

function targetSchema(
  coordinateScale: number,
  supportsElementTargets: boolean,
): Record<string, unknown> {
  if (!supportsElementTargets) return coordinateTargetSchema(coordinateScale);
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['element', 'coordinate'] },
      observationId: { type: 'string', minLength: 1, maxLength: 200 },
      elementId: { type: 'string', minLength: 1, maxLength: 512 },
      x: { type: 'integer', minimum: 0, maximum: coordinateScale - 1 },
      y: { type: 'integer', minimum: 0, maximum: coordinateScale - 1 },
    },
    required: ['kind', 'observationId'],
    additionalProperties: false,
  };
}

function coordinateTargetSchema(coordinateScale: number): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['coordinate'] },
      observationId: { type: 'string', minLength: 1, maxLength: 200 },
      x: { type: 'integer', minimum: 0, maximum: coordinateScale - 1 },
      y: { type: 'integer', minimum: 0, maximum: coordinateScale - 1 },
    },
    required: ['kind', 'observationId', 'x', 'y'],
    additionalProperties: false,
  };
}

function actionProperties(params: {
  actionKinds: readonly MobileControllerActionKind[];
  coordinateScale: number;
  supportsElementTargets: boolean;
  allowedAppIds?: readonly string[];
  timeoutMs: number;
}): Record<string, unknown> {
  const kinds = new Set(params.actionKinds);
  const properties: Record<string, unknown> = {
    kind: { type: 'string', enum: [...params.actionKinds] },
  };
  if (kinds.has('activate') || kinds.has('double_tap') || kinds.has('long_press')) {
    properties.target = targetSchema(params.coordinateScale, params.supportsElementTargets);
  }
  if (kinds.has('drag')) {
    properties.start = coordinateTargetSchema(params.coordinateScale);
    properties.end = coordinateTargetSchema(params.coordinateScale);
  }
  if (kinds.has('input_text')) {
    properties.text = {
      type: 'string',
      description:
        'Insert text at the current selection in the focused control. This does not clear existing content; establish the intended selection before replacing text.',
    };
  }
  if (kinds.has('open_app')) {
    properties.appId = params.allowedAppIds
      ? { type: 'string', enum: [...params.allowedAppIds] }
      : { type: 'string', minLength: 1, maxLength: 200 };
  }
  if (kinds.has('scroll')) {
    properties.direction = { type: 'string', enum: [...SCROLL_DIRECTIONS] };
  }
  if (kinds.has('wait')) {
    properties.durationMs = {
      type: 'integer',
      minimum: 100,
      maximum: Math.min(30_000, params.timeoutMs),
    };
  }
  return properties;
}

function buildDefinition(params: {
  actionKinds: readonly MobileControllerActionKind[];
  coordinateScale: number;
  supportsElementTargets: boolean;
  allowedAppIds?: readonly string[];
  timeoutMs: number;
}): ToolDefinition {
  return Object.freeze({
    name: MOBILE_UI_ACTION_TOOL_NAME,
    description:
      'Perform exactly one permitted primitive on the current mobile observation. ' +
      'Use the observation ID supplied by the controller for element or coordinate targets. ' +
      `Coordinate x/y values are normalized across the image from 0 to ${params.coordinateScale - 1}; do not use image pixel coordinates. ` +
      'This starts an external action; its later correlated outcome, not this call, determines progress.',
    input_schema: Object.freeze({
      type: 'object',
      properties: Object.freeze(actionProperties(params)),
      required: ['kind'],
      additionalProperties: false,
    }),
    strict: false,
    contract: MOBILE_UI_ACTION_CONTRACT,
  });
}

/** Stable reviewed registry identity. Runtime turns receive a narrower copy. */
export const MOBILE_UI_ACTION_TOOL_DEFINITION: ToolDefinition = buildDefinition({
  actionKinds: MOBILE_CONTROLLER_ACTION_KINDS,
  coordinateScale: 10_000,
  supportsElementTargets: true,
  timeoutMs: 15 * 60 * 1_000,
});

export function buildMobileControllerToolDefinition(
  capabilityCandidate: unknown,
): ToolDefinition | null {
  const capability: MobileControllerCapability | null =
    qualifyMobileControllerCapability(capabilityCandidate);
  if (!capability) return null;
  return buildDefinition({
    actionKinds: capability.supportedActionKinds,
    coordinateScale: capability.normalizedCoordinateScale,
    supportsElementTargets: capability.observationEvidence.includes('accessibility_snapshot'),
    allowedAppIds: capability.allowedAppIds,
    timeoutMs: capability.timeoutMs,
  });
}
