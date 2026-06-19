import type { ToolDefinition } from '../../../../types/tool';
import { nativeContract, RECOVERABLE_PLATFORM_ERRORS } from '../shared';

export const NOTIFICATION_SEND_TOOL: ToolDefinition = {
  name: 'notification_send',
  description: 'Send a local notification immediately to the user.',
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
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'medium',
    permissionPrerequisites: ['notifications.present'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['start_external_execution', 'verify_evidence'],
  }),
};

export const NOTIFICATION_SCHEDULE_TOOL: ToolDefinition = {
  name: 'notification_schedule',
  description: 'Schedule a local notification after a delay in seconds.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Notification title' },
      body: { type: 'string', description: 'Notification body text' },
      delaySeconds: { type: 'number', description: 'Delay before delivery in seconds' },
    },
    required: ['title', 'body', 'delaySeconds'],
  },
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'medium',
    permissionPrerequisites: ['notifications.schedule'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['start_external_execution', 'verify_evidence'],
    produces: [{ kind: 'notification_id' }],
    precedes: ['notification_cancel'],
  }),
};

export const NOTIFICATION_CANCEL_TOOL: ToolDefinition = {
  name: 'notification_cancel',
  description: 'Cancel a scheduled local notification by id.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Scheduled notification id to cancel' },
    },
    required: ['id'],
  },
  contract: nativeContract({
    category: 'communication',
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    riskLevel: 'medium',
    permissionPrerequisites: ['notifications.schedule'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS, 'not_found'],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['start_external_execution', 'verify_evidence'],
    consumes: [{ kind: 'notification_id' }],
  }),
};
