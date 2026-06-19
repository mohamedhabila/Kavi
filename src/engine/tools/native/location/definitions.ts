import type { ToolDefinition } from '../../../../types/tool';
import { nativeContract, RECOVERABLE_DEVICE_READ_ERRORS } from '../shared';

export const LOCATION_CURRENT_TOOL: ToolDefinition = {
  name: 'location_current',
  description: 'Get the current GPS location (latitude, longitude, altitude).',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: nativeContract({
    category: 'location',
    capabilities: ['read', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'high',
    permissionPrerequisites: ['location.foreground'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
    consumes: [{ kind: 'permission_state', field: 'location.foreground' }],
    produces: [{ kind: 'location' }],
    requiresPermissionEvidence: ['location.foreground'],
  }),
};
