import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { resolveTurnToolSurface } from '../../src/engine/goals/toolSurface';
import { WAIT_TOOL } from '../../src/engine/tools/builtin-definitions-utility';
import type { ToolDefinition } from '../../src/types/tool';
import { resourceFlowTools, userMessage } from '../helpers/turnToolSurfaceHarness';

describe('resolveDefaultGroundedRequestScopedTools', () => {
  it('keeps a completed wait available for the next sequential long-horizon wait', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: [WAIT_TOOL],
      observedToolNames: new Set(['wait']),
      workingMessages: [
        userMessage('Wait twice in sequence.', 1),
        {
          id: 'assistant-wait-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-wait-1',
              name: 'wait',
              arguments: '{"ms":60000}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-wait-1',
          role: 'tool',
          content: '{"status":"waited","waitedMs":60000}',
          toolCallId: 'tc-wait-1',
          timestamp: 3,
        },
      ],
    });

    expect(selected.some((tool) => tool.name === 'wait')).toBe(true);
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

  it('carries a prior-turn resource into the immediately following workflow continuation', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: resourceFlowTools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Create an event.', 1),
        {
          id: 'assistant-calendar-create',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-calendar-create',
              name: 'calendar_create_event',
              arguments: '{}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-calendar-create',
          role: 'tool',
          content: '{"status":"created_verified","eventId":"event-1"}',
          toolCallId: 'tc-calendar-create',
          timestamp: 3,
        },
        userMessage('Change it.', 4),
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('calendar_update_event')).toBe(true);
    expect(selectedToolNames.has('calendar_create_event')).toBe(false);
  });

  it('does not carry workflow resources past the immediately preceding user turn', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: resourceFlowTools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Create an event.', 1),
        {
          id: 'assistant-calendar-create',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-calendar-create',
              name: 'calendar_create_event',
              arguments: '{}',
              status: 'completed',
            },
          ],
        },
        userMessage('Thanks.', 3),
        {
          id: 'assistant-thanks',
          role: 'assistant',
          content: 'You are welcome.',
          timestamp: 4,
        },
        userMessage('Start something else.', 5),
      ],
    });

    expect(selected.map((tool) => tool.name)).not.toContain('calendar_update_event');
  });

  it('does not treat a failed prior-turn producer as a resource', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: resourceFlowTools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Create an event.', 1),
        {
          id: 'assistant-calendar-create-failed',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-calendar-create-failed',
              name: 'calendar_create_event',
              arguments: '{}',
              status: 'failed',
            },
          ],
        },
        userMessage('Continue.', 3),
      ],
    });

    expect(selected.map((tool) => tool.name)).not.toContain('calendar_update_event');
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
});
