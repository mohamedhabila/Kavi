import type { ToolDefinition } from '../../../../types/tool';
import {
  nativeContract,
  RECOVERABLE_DEVICE_READ_ERRORS,
  RECOVERABLE_PLATFORM_ERRORS,
} from '../shared';

export const CALENDAR_LIST_TOOL: ToolDefinition = {
  name: 'calendar_list',
  description: 'List all calendars on the device.',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: nativeContract({
    category: 'calendar',
    capabilities: ['discover', 'read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskLevel: 'medium',
    permissionPrerequisites: ['calendar.read'],
    recoverableErrors: [...RECOVERABLE_DEVICE_READ_ERRORS],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource', 'inspect_resource'],
    produces: [{ kind: 'calendar_id' }],
    precedes: ['calendar_create_event'],
  }),
};

export const CALENDAR_EVENTS_TOOL: ToolDefinition = {
  name: 'calendar_events',
  description: 'Get calendar events within a date range.',
  input_schema: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Start date (ISO 8601)' },
      endDate: { type: 'string', description: 'End date (ISO 8601)' },
      calendarId: { type: 'string', description: 'Specific calendar ID (optional)' },
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
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  }),
};

export const CALENDAR_CREATE_TOOL: ToolDefinition = {
  name: 'calendar_create_event',
  description:
    'Create a new calendar event. Use ISO 8601 dates (e.g. 2025-03-20T10:00:00). endDate must be after startDate. Pass a calendarId when targeting a specific calendar.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title' },
      startDate: {
        type: 'string',
        description: 'Start date/time in ISO 8601 (e.g. 2025-03-20T10:00:00)',
      },
      endDate: {
        type: 'string',
        description:
          'End date/time in ISO 8601. Must be after startDate. For 1-hour events, add 1 hour to startDate.',
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
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['calendar.write'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
    consumes: [{ kind: 'calendar_id', required: false }],
    produces: [{ kind: 'calendar_event' }],
    precedes: ['calendar_update_event'],
  }),
};

export const CALENDAR_UPDATE_TOOL: ToolDefinition = {
  name: 'calendar_update_event',
  description:
    'Update an existing calendar event by id. Provide only fields that should change. Use ISO 8601 dates when changing startDate or endDate.',
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
    capabilities: ['write', 'verify'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskLevel: 'high',
    permissionPrerequisites: ['calendar.write'],
    recoverableErrors: [...RECOVERABLE_PLATFORM_ERRORS, 'not_found'],
    riskHints: ['requires_approval'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
    consumes: [{ kind: 'calendar_event' }],
  }),
};
