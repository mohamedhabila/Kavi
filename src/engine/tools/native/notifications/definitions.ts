import type { ToolDefinition } from '../../../../types/tool';
import { nativeContract, RECOVERABLE_PLATFORM_ERRORS } from '../shared';

export const NOTIFICATION_SEND_TOOL: ToolDefinition = {
  name: 'notification_send',
  description:
    'Send a local notification immediately to the user. This does not cancel or replace a scheduled notification.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Notification title' },
      body: { type: 'string', description: 'Notification body text' },
    },
    required: ['title', 'body'],
  },
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'medium',
    permissionPrerequisites: ['notifications.present'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
  }),
};
