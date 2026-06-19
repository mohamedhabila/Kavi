import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { resolveTurnToolSurface } from '../../src/engine/goals/toolSurface';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';

const tools: ToolDefinition[] = [
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

const resourceFlowTools: ToolDefinition[] = [
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

function userMessage(content: string, timestamp = 1): Message {
  return {
    id: `user-${timestamp}`,
    role: 'user',
    content,
    timestamp,
  };
}

describe('resolveDefaultGroundedRequestScopedTools', () => {
  it('exposes stable graph-control and discovery tools when no graph surface is available', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [userMessage('Compare the docs and reply.')],
    });

    expect(selected.map((tool) => tool.name)).toEqual([
      'update_goals',
      'memory_recall',
      'memory_remember',
      'read_file',
      'write_file',
      'list_files',
      'tool_catalog',
      'tool_describe',
    ]);
  });

  it('keeps the discovery surface stable regardless of registry order', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: [...tools].reverse(),
      observedToolNames: new Set<string>(),
      workingMessages: [userMessage('Compare the docs and reply.')],
    });

    expect(selected.map((tool) => tool.name)).toEqual([
      'update_goals',
      'memory_recall',
      'memory_remember',
      'read_file',
      'write_file',
      'list_files',
      'tool_catalog',
      'tool_describe',
    ]);
  });

  it('surfaces memory resource tools from graph-owned memory goals', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      goals: [
        {
          id: 'memory-state',
          title: 'track-memory-facts',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write', 'read'],
          requiredResourceKinds: ['memory'],
        },
      ],
      workingMessages: [
        userMessage('Subject `longmem-entity` has access_code `LONGMEM-E2E-42`.'),
      ],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('memory_remember')).toBe(true);
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(false);
  });

  it('exposes discovery tools as a stable graph bootstrap surface', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: true,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
    expect(selectedToolNames.has('web_search')).toBe(false);
  });

  it('requires resource-scoped graph capability before code tools enter the hot surface', () => {
    const unscoped = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const scoped = resolveTurnToolSurface({
      allTools: tools,
      goals: [
        {
          id: 'compute-workspace',
          title: 'Compute workspace result',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['compute'],
          requiredResourceKinds: ['conversation_workspace'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const unscopedToolNames = new Set(unscoped.map((tool) => tool.name));
    const scopedToolNames = new Set(scoped.map((tool) => tool.name));
    expect(unscopedToolNames.has('python')).toBe(false);
    expect(unscopedToolNames.has('web_search')).toBe(false);
    expect(scopedToolNames.has('python')).toBe(true);
  });

  it('requires resource-scoped graph capability before side-effect tools enter the hot surface', () => {
    const unscoped = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const scoped = resolveTurnToolSurface({
      allTools: tools,
      goals: [
        {
          id: 'workspace-artifact',
          title: 'Persist workspace artifact',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write', 'read'],
          requiredResourceKinds: ['conversation_workspace'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const unscopedToolNames = new Set(unscoped.map((tool) => tool.name));
    const scopedToolNames = new Set(scoped.map((tool) => tool.name));
    expect(unscopedToolNames.has('write_file')).toBe(true);
    expect(unscopedToolNames.has('read_file')).toBe(true);
    expect(unscopedToolNames.has('browser_navigate')).toBe(false);
    expect(scopedToolNames.has('write_file')).toBe(true);
  });

  it('does not add latest-user selected side-effect tools without matching graph scope', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [
        {
          id: 'memory-state',
          title: 'Track durable memory',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['read', 'write'],
          requiredResourceKinds: ['memory'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
    expect(selectedToolNames.has('python')).toBe(false);
    expect(selectedToolNames.has('memory_recall')).toBe(true);
  });

  it('keeps read-only same-turn continuation without adding unrelated side-effect tools', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['list_files'],
      recentContinuationToolNames: new Set<string>(['list_files']),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('list_files')).toBe(true);
    expect(selectedToolNames.has('write_file')).toBe(true);
    expect(selectedToolNames.has('python')).toBe(false);
  });

  it('surfaces delegated session wait after a session producer has run', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      goals: [
        {
          id: 'delegated-work',
          title: 'Coordinate delegated worker',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['coordinate'],
        },
      ],
      observedToolNames: ['sessions_spawn'],
      workingMessages: [
        { id: 'u1', role: 'user', content: 'Delegate this and use the result.', timestamp: 1 },
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc1',
              name: 'sessions_spawn',
              arguments: '{"prompt":"do work"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 't1',
          role: 'tool',
          toolCallId: 'tc1',
          content: '{"status":"running","sessionId":"worker-1"}',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('sessions_spawn')).toBe(true);
    expect(selectedToolNames.has('sessions_wait')).toBe(true);
  });

  it('surfaces session delegation from worker evidence criteria without required capabilities', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      goals: [
        {
          id: 'worker-chain',
          title: 'Coordinate delegated worker',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          completionPolicy: 'blocking',
          successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
        },
      ],
      observedToolNames: [],
      workingMessages: [
        {
          id: 'u1',
          role: 'user',
          content: 'Delegate workstream worker-chain and record worker evidence.',
          timestamp: 1,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('sessions_spawn')).toBe(true);
  });

  it('does not keep direct latest-user side-effect tools after successful completion', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['write_file'],
      recentContinuationToolNames: new Set<string>(['write_file']),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
  });

  it('defers required workflow consumers when an upstream producer is available but unobserved', () => {
    const selected = resolveTurnToolSurface({
      allTools: resourceFlowTools,
      goals: [
        {
          id: 'mobile-action',
          title: 'Prepare mobile action',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['discover', 'read', 'write'],
          requiredResourceKinds: ['device'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('contacts_search')).toBe(true);
    expect(selectedToolNames.has('contacts_get')).toBe(false);
    expect(selectedToolNames.has('sms_compose')).toBe(true);
  });

  it('defers multi-input workflow consumers until every selected upstream producer has run', () => {
    const multiInputTools: ToolDefinition[] = [
      ...resourceFlowTools,
      {
        name: 'location_current',
        description: 'Resolve the current location.',
        input_schema: { type: 'object', properties: {}, required: [] },
        contract: {
          category: 'location',
          capabilities: ['discover', 'read'],
          resourceKinds: ['device'],
          produces: [{ kind: 'location_state' }],
        },
      },
      {
        name: 'nearby_contact_message',
        description: 'Prepare a contact message using contact and location context.',
        input_schema: { type: 'object', properties: {}, required: [] },
        contract: {
          category: 'communication',
          capabilities: ['write'],
          resourceKinds: ['device'],
          consumes: [{ kind: 'contact_candidate' }, { kind: 'location_state' }],
        },
      },
    ];

    const selected = resolveTurnToolSurface({
      allTools: multiInputTools,
      goals: [
        {
          id: 'mobile-action',
          title: 'Prepare mobile action',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['discover', 'read', 'write'],
          requiredResourceKinds: ['device'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['contacts_search'],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('location_current')).toBe(true);
    expect(selectedToolNames.has('nearby_contact_message')).toBe(false);
  });

  it('surfaces required workflow consumers after the upstream producer has run', () => {
    const selected = resolveTurnToolSurface({
      allTools: resourceFlowTools,
      goals: [
        {
          id: 'mobile-action',
          title: 'Prepare mobile action',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['read', 'write'],
          requiredResourceKinds: ['device'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['contacts_search'],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('contacts_get')).toBe(true);
    expect(selectedToolNames.has('sms_compose')).toBe(true);
  });

  it('surfaces required workflow consumers after a same-turn continuation producer', () => {
    const selected = resolveTurnToolSurface({
      allTools: resourceFlowTools,
      goals: [
        {
          id: 'mobile-action',
          title: 'Prepare mobile action',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['read', 'write'],
          requiredResourceKinds: ['device'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(['contacts_search']),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('contacts_get')).toBe(true);
  });

  it('lets blocked resource-scoped goals continue to downstream side-effect tools', () => {
    const sideEffectResourceFlowTools = resourceFlowTools.map((tool) =>
      tool.name === 'sms_compose'
        ? {
            ...tool,
            contract: {
              ...tool.contract,
              sideEffects: ['external_run'],
            },
          }
        : tool,
    );
    const selected = resolveTurnToolSurface({
      allTools: sideEffectResourceFlowTools,
      goals: [
        {
          id: 'mobile-action',
          title: 'Prepare mobile action',
          status: 'blocked',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['read', 'write'],
          requiredResourceKinds: ['device'],
          successCriteria: ['evidence.json_field:status:sms_composer_opened'],
          blockedReason: 'waiting for user message content',
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['contacts_search'],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('contacts_get')).toBe(true);
    expect(selectedToolNames.has('sms_compose')).toBe(true);
  });

  it('does not expose workflow consumers without graph or discovery scope', () => {
    const selected = resolveTurnToolSurface({
      allTools: resourceFlowTools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    expect(selected.map((tool) => tool.name)).not.toContain('contacts_get');
  });

  it('exposes safe mobile discovery tools without exposing mobile side-effect consumers', () => {
    const selected = resolveTurnToolSurface({
      allTools: resourceFlowTools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: true,
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('contacts_search')).toBe(true);
    expect(names.has('sms_compose')).toBe(false);
    expect(names.has('contacts_get')).toBe(false);
  });

  it('treats artifact success criteria as live workspace writer scope', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [
        {
          id: 'artifact-goal',
          title: 'Persist artifact',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          successCriteria: ['evidence.artifact:artifacts/e2e-goal.txt'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
    expect(selectedToolNames.has('file_edit')).toBe(true);
    expect(selectedToolNames.has('browser_navigate')).toBe(false);
  });

  it('does not keep completed artifact writers selected from continuation alone', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [
        {
          id: 'done-artifact',
          title: 'Persisted artifact',
          status: 'completed',
          dependencies: [],
          evidence: ['write_file:{"status":"written","path":"artifacts/e2e-goal.txt"}'],
          createdAt: 1,
          updatedAt: 2,
          completedAt: 2,
          successCriteria: ['evidence.artifact:artifacts/e2e-goal.txt'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['write_file'],
      recentContinuationToolNames: new Set(['write_file']),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    expect(selected.some((tool) => tool.name === 'write_file')).toBe(true);
  });

  it('does not repin observed side-effect tools without live graph scope', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['write_file', 'read_file'],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
    expect(selectedToolNames.has('read_file')).toBe(true);
  });

  it('loads the discovered category tools on the turn after tool_catalog', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Find the browser tools and continue.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc1',
              name: 'tool_catalog',
              arguments: '{"category":"browser"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'category',
            category: 'browser',
            tools: [
              { name: 'browser_navigate' },
              { name: 'browser_click' },
              { name: 'browser_snapshot' },
            ],
          }),
          toolCallId: 'tc1',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('browser_navigate')).toBe(true);
    expect(selectedToolNames.has('browser_snapshot')).toBe(true);
    expect(selectedToolNames.has('browser_click')).toBe(true);
    expect(selectedToolNames.has('expo_eas_list_projects')).toBe(false);
  });

  it('loads code tools on the turn after tool_catalog discovers the code category', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Find code tools and continue.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-code',
              name: 'tool_catalog',
              arguments: '{"category":"code"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'category',
            category: 'code',
            tools: [{ name: 'javascript' }, { name: 'python' }],
          }),
          toolCallId: 'tc-code',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('javascript')).toBe(true);
    expect(selectedToolNames.has('python')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
  });

  it('loads pdf tools on the turn after tool_catalog discovers the pdf category', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Find the PDF tools and continue.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-pdf',
              name: 'tool_catalog',
              arguments: '{"category":"pdf"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'category',
            category: 'pdf',
            tools: [{ name: 'pdf_read' }],
          }),
          toolCallId: 'tc-pdf',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('pdf_read')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
  });

  it('loads search hits on the turn after tool_catalog search', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Search the catalog for memory recall tooling.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-search',
              name: 'tool_catalog',
              arguments: '{"query":"memory_recall","capabilities":["read"]}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'search',
            query: 'memory_recall',
            tools: [{ name: 'memory_recall' }],
          }),
          toolCallId: 'tc-search',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_recall')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
  });

  it('loads described tools on the turn after tool_describe', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Describe memory recall before using it.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-describe',
              name: 'tool_describe',
              arguments: '{"name":"memory_recall"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'describe',
            tool: { name: 'memory_recall' },
          }),
          toolCallId: 'tc-describe',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_recall')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
  });

  it('keeps catalog-activated tools on surface across a new user turn via session cache', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      sessionActivatedToolNames: ['memory_recall'],
      workingMessages: [
        userMessage('Find memory recall tooling.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-search',
              name: 'tool_catalog',
              arguments: '{"query":"memory_recall"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'search',
            query: 'memory_recall',
            tools: [{ name: 'memory_recall' }],
          }),
          toolCallId: 'tc-search',
          timestamp: 3,
        },
        userMessage('Use memory recall now.'),
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_recall')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
  });

  it('drops non-core catalog activation on a new user turn without session cache', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Find memory recall tooling.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-search',
              name: 'tool_catalog',
              arguments: '{"query":"memory_recall"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'search',
            query: 'memory_recall',
            tools: [{ name: 'memory_recall' }],
          }),
          toolCallId: 'tc-search',
          timestamp: 3,
        },
        userMessage('Use memory recall now.'),
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_recall')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
  });

  it('does not carry forward side-effectful category tools from recent use alone', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Inspect the page and continue.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-browser',
              name: 'browser_navigate',
              arguments: '{"urls":["https://example.com"]}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: '{"ok":true}',
          toolCallId: 'tc-browser',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('browser_navigate')).toBe(false);
    expect(selectedToolNames.has('browser_snapshot')).toBe(false);
    expect(selectedToolNames.has('browser_click')).toBe(false);
  });

  it('keeps SMS composition eligible after contact search produces contact candidates', async () => {
    const sideEffectResourceFlowTools = resourceFlowTools.map((tool) =>
      tool.name === 'sms_compose'
        ? {
            ...tool,
            contract: {
              ...tool.contract,
              sideEffects: ['external_run'],
            },
          }
        : tool,
    );
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: sideEffectResourceFlowTools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Find Avery and text them.'),
        {
          id: 'assistant-contacts',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-contacts',
              name: 'contacts_search',
              arguments: '{"query":"Avery"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-contacts',
          role: 'tool',
          content: '[{"id":"avery","phoneNumbers":[{"number":"+15550101001"}]}]',
          toolCallId: 'tc-contacts',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('contacts_search')).toBe(true);
    expect(selectedToolNames.has('sms_compose')).toBe(true);
    expect(selectedToolNames.has('calendar_update_event')).toBe(false);
  });

  it('keeps calendar update eligible after calendar create produces an event resource', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: resourceFlowTools,
      observedToolNames: new Set(['calendar_create_event']),
      workingMessages: [userMessage('Update the event I just created.')],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('calendar_create_event')).toBe(false);
    expect(selectedToolNames.has('calendar_update_event')).toBe(true);
    expect(selectedToolNames.has('sms_compose')).toBe(false);
  });

  it('keeps notification cancel eligible after notification schedule produces an id', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: resourceFlowTools,
      observedToolNames: new Set(['notification_schedule']),
      workingMessages: [userMessage('Cancel the notification I just scheduled.')],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('notification_schedule')).toBe(false);
    expect(selectedToolNames.has('notification_cancel')).toBe(true);
    expect(selectedToolNames.has('calendar_update_event')).toBe(false);
  });

  it('keeps memory discovery activation additive with active mobile goals', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: resourceFlowTools,
      observedToolNames: new Set<string>(),
      sessionActivatedToolNames: ['memory_recall'],
      goals: [
        {
          id: 'mobile-action',
          title: 'mobile action',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write', 'verify'],
          requiredResourceKinds: ['device'],
        },
      ],
      workingMessages: [userMessage('Use what you remember, then text Avery.')],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_recall')).toBe(true);
    expect(selectedToolNames.has('sms_compose')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
  });

  it('keeps pending async monitor tools without broad default or discovery fallback', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set(['read_file', 'web_search']),
      pendingAsyncMonitorToolNames: new Set(['sessions_status']),
      workingMessages: [userMessage('Recall the stored fact.')],
    });

    expect(selected.some((tool) => tool.name === 'sessions_status')).toBe(true);
    expect(selected.some((tool) => tool.name === 'write_file')).toBe(true);
    expect(selected.some((tool) => tool.name === 'tool_catalog')).toBe(false);
  });

  it('surfaces session-activated tools without discovery pins', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      sessionActivatedToolNames: ['memory_recall'],
      workingMessages: [userMessage('Recall the stored fact.')],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
  });

  it('suppresses side-effectful session activations without live graph scope', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      sessionActivatedToolNames: ['write_file', 'memory_remember'],
      goals: [
        {
          id: 'done-file',
          title: 'Done file task',
          status: 'completed',
          dependencies: [],
          evidence: ['write_file:done'],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['conversation_workspace'],
        },
      ],
      workingMessages: [userMessage('Verify the saved state.')],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('write_file')).toBe(true);
    expect(names.has('memory_remember')).toBe(true);
  });

  it('keeps discovery tools after catalog activation exposes callable tools', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      sessionActivatedToolNames: ['memory_recall'],
      workingMessages: [userMessage('Recall the stored fact.')],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps discovery tools after same-turn activation', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Discover memory recall.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-catalog',
              name: 'tool_catalog',
              arguments: '{"query":"memory_recall"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content:
            '{"tools":[{"name":"memory_recall","activation":{"name":"memory_recall","eligible":true,"callableNow":false}}]}',
          toolCallId: 'tc-catalog',
          timestamp: 3,
        },
      ],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps web_search available after prior search and fetch activity', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Compare the docs and reply.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-search',
              name: 'web_search',
              arguments: '{"queries":["OpenAI structured outputs docs"]}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            provider: 'gemini',
            searches: [
              {
                query: 'OpenAI structured outputs docs',
                results: [
                  {
                    title: 'Structured outputs',
                    url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
                  },
                ],
              },
            ],
          }),
          toolCallId: 'tc-search',
          timestamp: 3,
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: '',
          timestamp: 4,
          toolCalls: [
            {
              id: 'tc-fetch',
              name: 'web_fetch',
              arguments:
                '{"urls":["https://developers.openai.com/api/docs/guides/structured-outputs"]}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-2',
          role: 'tool',
          content: JSON.stringify({
            fetches: [
              {
                url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
                content: 'Structured outputs guide',
              },
            ],
          }),
          toolCallId: 'tc-fetch',
          timestamp: 5,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('web_search')).toBe(true);
    expect(selectedToolNames.has('web_fetch')).toBe(true);
  });
});
