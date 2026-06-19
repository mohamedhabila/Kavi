import type { ToolDefinition } from '../../../../types/tool';
import { nativeContract } from '../shared';

export const HAPTIC_FEEDBACK_TOOL: ToolDefinition = {
  name: 'haptic_feedback',
  description: 'Trigger haptic feedback on the device. Use for confirmations or alerts.',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description:
          'Feedback type: light, medium, heavy, success, warning, error (default: medium)',
      },
    },
  },
  contract: nativeContract({
    category: 'device',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'low',
    permissionPrerequisites: ['haptics.available'],
    recoverableErrors: ['platform_unavailable', 'transient_native_error'],
    riskHints: ['requires_approval'],
    providesEvidence: ['verification'],
    workflowStages: ['start_external_execution', 'verify_evidence'],
  }),
};
