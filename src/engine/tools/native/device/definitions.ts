import type { ToolDefinition } from '../../../../types/tool';
import { nativeContract, NO_PERMISSION_PREREQUISITES } from '../shared';

export const DEVICE_STATUS_TOOL: ToolDefinition = {
  name: 'device_status',
  description:
    'Get current device status: battery level, network connectivity, screen brightness, and volume.',
  input_schema: { type: 'object', properties: {} },
  contract: nativeContract({
    category: 'device',
    capabilities: ['read', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'low',
    permissionPrerequisites: NO_PERMISSION_PREREQUISITES,
    recoverableErrors: ['platform_unavailable', 'transient_native_error'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  }),
};

export const DEVICE_INFO_TOOL: ToolDefinition = {
  name: 'device_info',
  description:
    'Get device hardware and software info: model, OS version, memory, storage, screen dimensions.',
  input_schema: { type: 'object', properties: {} },
  contract: nativeContract({
    category: 'device',
    capabilities: ['read', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'medium',
    permissionPrerequisites: NO_PERMISSION_PREREQUISITES,
    recoverableErrors: ['platform_unavailable', 'transient_native_error'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  }),
};

export const DEVICE_PERMISSIONS_TOOL: ToolDefinition = {
  name: 'device_permissions',
  description: 'List all app permissions and their current status (granted, denied, undetermined).',
  input_schema: { type: 'object', properties: {} },
  contract: nativeContract({
    category: 'device',
    capabilities: ['read', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'medium',
    permissionPrerequisites: NO_PERMISSION_PREREQUISITES,
    recoverableErrors: ['platform_unavailable', 'transient_native_error'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
    produces: [
      { kind: 'permission_state', field: 'location.foreground' },
      { kind: 'permission_state', field: 'media_library.read' },
      { kind: 'permission_state', field: 'notifications.schedule' },
      { kind: 'permission_state', field: 'contacts.read' },
    ],
    precedes: ['location_current'],
  }),
};

export const DEVICE_HEALTH_TOOL: ToolDefinition = {
  name: 'device_health',
  description: 'Get device health metrics: memory usage, storage usage, thermal state, uptime.',
  input_schema: { type: 'object', properties: {} },
  contract: nativeContract({
    category: 'device',
    capabilities: ['read', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'medium',
    permissionPrerequisites: NO_PERMISSION_PREREQUISITES,
    recoverableErrors: ['platform_unavailable', 'transient_native_error'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  }),
};

export const DEVICE_QUERY_TOOL: ToolDefinition = {
  name: 'device_query',
  description:
    'Query device state. Use kind to choose what to read: ' +
    'status (battery, network, brightness, volume), ' +
    'info (hardware/software model, OS, memory, storage, screen), ' +
    'permissions (app permission grants), or ' +
    'health (memory/storage usage, thermal state, uptime).',
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['status', 'info', 'permissions', 'health'],
        description: 'Which device facet to query.',
      },
    },
    required: ['kind'],
  },
  contract: nativeContract({
    category: 'device',
    capabilities: ['read', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'medium',
    permissionPrerequisites: NO_PERMISSION_PREREQUISITES,
    recoverableErrors: ['platform_unavailable', 'transient_native_error'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
    produces: [
      { kind: 'permission_state', field: 'location.foreground' },
      { kind: 'permission_state', field: 'media_library.read' },
      { kind: 'permission_state', field: 'notifications.schedule' },
      { kind: 'permission_state', field: 'contacts.read' },
    ],
    precedes: ['location_current'],
  }),
};
