import type { ToolDefinition } from '../../../../types/tool';
import {
  nativeContract,
  RECOVERABLE_DEVICE_READ_ERRORS,
  RECOVERABLE_PLATFORM_ERRORS,
} from '../shared';

export const CALENDAR_LIST_TOOL: ToolDefinition = {
  name: 'calendar_list',
  description:
    'List calendars on the device to verify calendar access and whether a writable calendar is available. This does not inspect free/busy time and requires no date range; use calendar_events only when events within a specific range are needed.',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: nativeContract({
    category: 'calendar',
    capabilities: ['discover', 'read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'medium',
    permissionPrerequisites: ['calendar.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS],
    riskHints: ['read_only', 'idempotent', 'requires_approval'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource', 'inspect_resource'],
    produces: [{ kind: 'calendar_id' }],
    precedes: ['calendar_create_event'],
  }),
};

/**
 * A time the source gives with a zone keeps it: the model copies 09:15 UTC as 09:15Z instead
 * of converting it to device time itself, which is where cross-timezone times went wrong.
 */
const CALENDAR_TIME_FORMAT =
  'Times are ISO 8601. A plan in the device timezone has no offset (2026-03-20T10:00:00). A time ' +
  "the source states in UTC or in another place's timezone keeps that zone: copy it as written " +
  'with its offset or Z (a 09:15 UTC departure is 2026-05-04T09:15:00Z) and never convert it ' +
  'yourself; the calendar shows it in local time.';

export const CALENDAR_EVENTS_TOOL: ToolDefinition = {
  name: 'calendar_events',
  description:
    'Get calendar events within a specific date range. Use calendar_list instead when the request is only to verify calendar access or writable-calendar availability.',
  input_schema: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Start date (ISO 8601)' },
      endDate: { type: 'string', description: 'End date (ISO 8601)' },
      calendarId: {
        type: 'string',
        description:
          'Calendar ID from calendar_list, to search one calendar. Omit to search every calendar.',
      },
    },
    required: ['startDate', 'endDate'],
  },
  contract: nativeContract({
    category: 'calendar',
    capabilities: ['read', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'medium',
    permissionPrerequisites: ['calendar.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS],
    riskHints: ['read_only', 'idempotent', 'requires_approval'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
    produces: [{ kind: 'calendar_event' }],
    precedes: ['calendar_update_event'],
  }),
};

export const CALENDAR_CREATE_TOOL: ToolDefinition = {
  name: 'calendar_create_event',
  description: `Create a new calendar event. ${CALENDAR_TIME_FORMAT} endDate must be after startDate. Pass a calendarId when targeting a specific calendar.`,
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title' },
      startDate: {
        type: 'string',
        description:
          'Start date-time in ISO 8601: offset-less for device time, or with the zone the source gives',
      },
      endDate: {
        type: 'string',
        description:
          'End date-time in ISO 8601, in the same form as startDate and after it. For a 1-hour event, add 1 hour to startDate.',
      },
      location: { type: 'string', description: 'Event location (optional)' },
      notes: { type: 'string', description: 'Event notes (optional)' },
      calendarId: {
        type: 'string',
        description:
          'Calendar ID from calendar_list. If omitted, uses the default writable calendar.',
      },
      allDay: { type: 'boolean', description: 'If true, creates an all-day event' },
    },
    required: ['title', 'startDate', 'endDate'],
  },
  contract: nativeContract({
    category: 'calendar',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['calendar.write'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact'],
    workflowStages: ['persist_artifact'],
    consumes: [{ kind: 'calendar_id', required: false }],
    produces: [{ kind: 'calendar_event' }],
    precedes: ['calendar_update_event'],
  }),
};

export const CALENDAR_UPDATE_TOOL: ToolDefinition = {
  name: 'calendar_update_event',
  description: `Update an existing calendar event by id. Provide only fields that should change. ${CALENDAR_TIME_FORMAT}`,
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Calendar event id to update' },
      title: { type: 'string', description: 'Updated event title' },
      startDate: { type: 'string', description: 'Updated start date/time in ISO 8601' },
      endDate: { type: 'string', description: 'Updated end date/time in ISO 8601' },
      location: { type: 'string', description: 'Updated event location' },
      notes: { type: 'string', description: 'Updated event notes' },
      allDay: { type: 'boolean', description: 'Updated all-day flag' },
    },
    required: ['id'],
  },
  contract: nativeContract({
    category: 'calendar',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['calendar.write'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS, 'not_found'],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact'],
    workflowStages: ['persist_artifact'],
    consumes: [{ kind: 'calendar_event' }],
  }),
};
