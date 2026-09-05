import type { ToolDefinition } from '../../../../types/tool';
import { nativeContract, RECOVERABLE_PLATFORM_ERRORS } from '../shared';

export const REMINDER_TOOL: ToolDefinition = {
  name: 'reminder',
  description:
    'Create, list, update, or cancel a personal reminder. Unlike cron, a reminder never resumes a ' +
    'conversation — the operating system delivers it as a real notification straight from the lock ' +
    'screen or notification center, even while the app is closed or the device is offline. ' +
    'Use this tool for a person\'s reminder (e.g. "remind me to call mom at 6pm", "remind me every ' +
    'weekday at 9am to check standup notes", "remind me on the 1st of each month to pay rent"). Use ' +
    'the cron tool instead for an automated assistant task that should run a prompt on a schedule. ' +
    'This tool never parses natural language: resolve relative phrases like "tomorrow" or "in an ' +
    'hour" to an explicit ISO-8601 date-time or 24-hour "HH:MM" yourself before calling. For kind ' +
    '"once", prefer an offset-less local date-time in "when.at" plus an IANA "timezone" over ' +
    'computing a UTC offset yourself. ' +
    'The "list" action is read-only and returns all pending reminders sorted by next fire time; ' +
    'create, update, and cancel change device state and ask the user to confirm first.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'update', 'cancel'],
        description: 'Action to perform.',
      },
      id: {
        type: 'string',
        description: 'Reminder id, required for update and cancel.',
      },
      title: {
        type: 'string',
        description: 'Reminder title, shown as the notification title. Required for create.',
      },
      notes: {
        type: 'string',
        description: 'Optional additional detail, shown as the notification body.',
      },
      when: {
        type: 'object',
        description:
          'Structured schedule. Required for create; optional for update (omit to keep the ' +
          'existing schedule).',
        properties: {
          kind: {
            type: 'string',
            enum: ['once', 'daily', 'weekdays', 'weekly', 'monthly'],
            description: 'Recurrence kind.',
          },
          at: {
            type: 'string',
            description:
              'ISO-8601 date-time. Required when kind is "once". Preferred form: an offset-less local ' +
              'date-time paired with "timezone" (e.g. "2026-09-10T14:00:00" with timezone ' +
              '"Europe/Amsterdam") — it is resolved against that IANA zone, DST-corrected. An explicit ' +
              'UTC offset or "Z" (e.g. "2026-09-10T14:00:00-04:00") also works and names an absolute ' +
              'instant independent of "timezone". A local time that falls in a DST spring-forward gap ' +
              'is shifted forward to the first valid instant, the same way calendar apps handle it.',
          },
          time: {
            type: 'string',
            description:
              '24-hour "HH:MM" time of day (e.g. "09:00"). Required when kind is "daily", "weekdays", ' +
              '"weekly", or "monthly".',
          },
          weekday: {
            type: 'number',
            description:
              'ISO-8601 weekday, 1=Monday through 7=Sunday. Required when kind is "weekly".',
          },
          dayOfMonth: {
            type: 'number',
            description:
              'Day of month, 1-31. Required when kind is "monthly". A month shorter than this day is skipped.',
          },
        },
        required: ['kind'],
      },
      timezone: {
        type: 'string',
        description:
          'IANA time zone, e.g. "Europe/Berlin". Defaults to the device time zone. Also the zone an ' +
          'offset-less "when.at" is resolved against for kind "once".',
      },
    },
    required: ['action'],
  },
  contract: nativeContract({
    category: 'communication',
    capabilities: ['read', 'write'],
    resourceKinds: ['device'],
    sideEffects: ['external_run'],
    // Low, not medium: a reminder is user-requested, fully reversible (update/cancel
    // at any time), and always visible via the tool's own list action. It never
    // reaches outside the device or resumes a conversation the way cron does, so it
    // does not carry requires_approval — see the matching exemption and comment in
    // src/services/remote/approvalPolicy.ts's requiresActionApproval.
    riskLevel: 'low',
    permissionPrerequisites: ['notifications.schedule'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS, 'not_found'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
    produces: [{ kind: 'reminder_id' }],
    consumes: [{ kind: 'reminder_id', required: false }],
  }),
};
