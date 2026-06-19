import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';

export const tools: ToolDefinition[] = [
  {
    name: 'update_goals',
    description: 'Update graph goals.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'tools',
      capabilities: ['coordinate'],
      resourceKinds: ['conversation_workspace'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    contract: {
      category: 'workspace_files',
      capabilities: ['read'],
      resourceKinds: ['conversation_workspace'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    contract: {
      category: 'workspace_files',
      capabilities: ['write'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['local_artifact'],
    },
  },
  {
    name: 'sessions_spawn',
    description: 'Start a delegated worker session.',
    input_schema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'],
    },
    contract: {
      category: 'sessions',
      capabilities: ['coordinate'],
      resourceKinds: ['unknown'],
      sideEffects: ['external_run'],
      produces: [{ kind: 'sub_agent_session' }],
      precedes: ['sessions_wait'],
    },
  },
  {
    name: 'sessions_wait',
    description: 'Wait for a delegated worker session.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
    contract: {
      category: 'sessions',
      capabilities: ['wait', 'verify'],
      resourceKinds: ['unknown'],
      sideEffects: ['none'],
      consumes: [{ kind: 'sub_agent_session', required: false }],
    },
  },
  {
    name: 'sessions_status',
    description: 'Inspect a delegated worker session.',
    input_schema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'list_files',
    description: 'List files.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'file_edit',
    description: 'Edit a file.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    contract: {
      category: 'workspace_files',
      capabilities: ['write', 'verify'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['local_artifact'],
    },
  },
  {
    name: 'glob_search',
    description: 'Find files.',
    input_schema: {
      type: 'object',
      properties: { pattern: { type: 'string' } },
      required: ['pattern'],
    },
  },
  {
    name: 'text_search',
    description: 'Find text.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'javascript',
    description: 'Run JavaScript.',
    input_schema: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
    contract: {
      category: 'code',
      capabilities: ['compute'],
      resourceKinds: ['conversation_workspace'],
    },
  },
  {
    name: 'python',
    description: 'Run Python.',
    input_schema: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
    contract: {
      category: 'code',
      capabilities: ['compute'],
      resourceKinds: ['conversation_workspace'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web.',
    input_schema: {
      type: 'object',
      properties: { queries: { type: 'array', items: { type: 'string' } } },
      required: ['queries'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch a page.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'pdf_read',
    description: 'Read a PDF.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'tool_catalog',
    description: 'Browse tools by category.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'tool_describe',
    description: 'Describe one tool.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'memory_recall',
    description: 'Recall memory facts.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'memory',
      capabilities: ['discover', 'read'],
      resourceKinds: ['memory'],
    },
  },
  {
    name: 'memory_remember',
    description: 'Remember memory facts.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'memory',
      capabilities: ['write'],
      resourceKinds: ['memory'],
      sideEffects: ['local_artifact'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate a browser session.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
    contract: {
      category: 'browser',
      capabilities: ['read', 'write', 'verify'],
      resourceKinds: ['browser'],
      sideEffects: ['external_run'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click in a browser session.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
    },
    contract: {
      category: 'browser',
      capabilities: ['write', 'verify'],
      resourceKinds: ['browser'],
      sideEffects: ['external_run'],
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Inspect browser state.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'browser',
      capabilities: ['read', 'verify'],
      resourceKinds: ['browser'],
      sideEffects: ['none'],
    },
  },
  {
    name: 'expo_eas_list_projects',
    description: 'List Expo projects.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

export const resourceFlowTools: ToolDefinition[] = [
  {
    name: 'contacts_search',
    description: 'Search contacts.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'contacts',
      capabilities: ['discover', 'read'],
      resourceKinds: ['device'],
      produces: [{ kind: 'contact_candidate' }],
    },
  },
  {
    name: 'contacts_get',
    description: 'Get contact details by id.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'contacts',
      capabilities: ['read'],
      resourceKinds: ['device'],
      consumes: [{ kind: 'contact_candidate' }],
      produces: [{ kind: 'contact_detail' }],
    },
  },
  {
    name: 'sms_compose',
    description: 'Compose SMS.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'communication',
      capabilities: ['write', 'verify'],
      resourceKinds: ['device'],
      consumes: [
        { kind: 'phone_number', required: false },
        { kind: 'contact_candidate', field: 'phoneNumbers', required: false },
      ],
    },
  },
  {
    name: 'calendar_create_event',
    description: 'Create calendar event.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'calendar',
      capabilities: ['write', 'verify'],
      resourceKinds: ['device'],
      produces: [{ kind: 'calendar_event' }],
    },
  },
  {
    name: 'calendar_update_event',
    description: 'Update calendar event.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'calendar',
      capabilities: ['write', 'verify'],
      resourceKinds: ['device'],
      consumes: [{ kind: 'calendar_event' }],
    },
  },
  {
    name: 'notification_schedule',
    description: 'Schedule notification.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'notifications',
      capabilities: ['write', 'verify'],
      resourceKinds: ['device'],
      produces: [{ kind: 'notification_id' }],
    },
  },
  {
    name: 'notification_cancel',
    description: 'Cancel notification.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'notifications',
      capabilities: ['write', 'verify'],
      resourceKinds: ['device'],
      consumes: [{ kind: 'notification_id' }],
    },
  },
  {
    name: 'memory_recall',
    description: 'Recall memory.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'memory',
      capabilities: ['read'],
      resourceKinds: ['memory'],
    },
  },
  {
    name: 'tool_catalog',
    description: 'Browse tools.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'tools',
      capabilities: ['discover'],
      resourceKinds: ['unknown'],
    },
  },
  {
    name: 'tool_describe',
    description: 'Describe tool.',
    input_schema: { type: 'object', properties: {}, required: [] },
    contract: {
      category: 'tools',
      capabilities: ['discover'],
      resourceKinds: ['unknown'],
    },
  },
];

export function userMessage(content: string, timestamp = 1): Message {
  return {
    id: `user-${timestamp}`,
    role: 'user',
    content,
    timestamp,
  };
}
