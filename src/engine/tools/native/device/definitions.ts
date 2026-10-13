import type { ToolDefinition } from '../../../../types/tool';
import { nativeContract, NO_PERMISSION_PREREQUISITES } from '../shared';

export const DEVICE_QUERY_TOOL: ToolDefinition = {
  name: 'device_query',
  description:
    'Query device state. kind defaults to status. Use kind to choose what to read: ' +
    'status (battery availability, level and charging state; network connectivity; screen dimensions), ' +
    'info (hardware/software model, OS, memory, storage, screen), ' +
    'permissions (app permission grants), or ' +
    'health (bounded memory/storage capacity, battery level, and uptime evidence).',
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['status', 'info', 'permissions', 'health'],
        description: 'Which device facet to query. Defaults to status.',
      },
    },
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
