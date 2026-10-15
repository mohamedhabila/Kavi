import type { ToolDefinition } from '../../../../types/tool';
import {
  nativeContract,
  RECOVERABLE_DEVICE_READ_ERRORS,
  RECOVERABLE_PLATFORM_ERRORS,
} from '../shared';

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

/** Most notifications one call returns, and the longest look back it may ask for. */
export const NOTIFICATIONS_READ_MAX_LIMIT = 100;
export const NOTIFICATIONS_READ_MAX_SINCE_MINUTES = 7 * 24 * 60;

export const NOTIFICATIONS_READ_TOOL: ToolDefinition = {
  name: 'notifications_read',
  description:
    'Read the notifications other apps showed on this phone: messages, deliveries, alerts, ' +
    'reminders, what the person missed. Each has the app, title, text, time, and whether it ' +
    'still shows. Android only, once the person turned on notification access for Kavi; ' +
    'covers what arrived since then while the phone was on.',
  input_schema: {
    type: 'object',
    properties: {
      since_minutes: {
        type: 'number',
        description: `How far back to look, in minutes (default 1440, max ${NOTIFICATIONS_READ_MAX_SINCE_MINUTES}).`,
      },
      limit: {
        type: 'number',
        description: `Most notifications to return, newest first (default 30, max ${NOTIFICATIONS_READ_MAX_LIMIT}).`,
      },
    },
  },
  contract: nativeContract({
    category: 'communication',
    capabilities: ['discover', 'read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'high',
    permissionPrerequisites: ['notifications.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS],
    riskHints: ['read_only', 'idempotent', 'requires_approval'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource', 'inspect_resource'],
  }),
};
