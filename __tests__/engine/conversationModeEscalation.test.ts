import {
  buildConversationModeEscalationDetail,
  detectChitchatModeEscalation,
} from '../../src/engine/graph/conversation/modeEscalation';
import type { ToolDefinition } from '../../src/types/tool';

const calendarCreate: ToolDefinition = {
  name: 'calendar_create_event',
  description: 'Create a calendar event.',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: {
    category: 'calendar',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_state'],
  },
};

const memoryWrite: ToolDefinition = {
  name: 'memory_remember',
  description: 'Store a durable fact.',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: {
    category: 'memory',
    capabilities: ['write'],
    resourceKinds: ['memory'],
    sideEffects: ['local_artifact'],
  },
};

const calendarRead: ToolDefinition = {
  name: 'calendar_events',
  description: 'Read calendar events.',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: {
    category: 'calendar',
    capabilities: ['read'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
  },
};

const sessionSpawn: ToolDefinition = {
  name: 'sessions_spawn',
  description: 'Start a delegated worker session.',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: {
    category: 'sessions',
    capabilities: ['coordinate'],
    resourceKinds: ['session'],
    sideEffects: ['external_state'],
  },
};

const openWorldDeviceAutomation: ToolDefinition = {
  name: 'device_automation',
  description: 'Drive an arbitrary device action.',
  input_schema: { type: 'object', properties: {}, required: [] },
  contract: {
    category: 'device',
    capabilities: ['write'],
    resourceKinds: ['device'],
    sideEffects: ['external_state'],
    riskHints: ['open_world'],
  },
};

const allTools = [
  calendarCreate,
  memoryWrite,
  calendarRead,
  sessionSpawn,
  openWorldDeviceAutomation,
];

describe('detectChitchatModeEscalation', () => {
  it('escalates when chitchat discovers a tool only an agentic run may call', () => {
    const result = detectChitchatModeEscalation({
      conversationMode: 'chitchat',
      allTools,
      activatedCatalogToolNames: new Set(['sessions_spawn']),
    });

    expect(result.required).toBe(true);
    if (!result.required) throw new Error('expected escalation');
    expect(result.reason).toBe('agentic_capability_discovered');
    expect(result.blockedToolNames).toEqual(['sessions_spawn']);
  });

  it('escalates for an open-world tool that can act on what it reaches', () => {
    const result = detectChitchatModeEscalation({
      conversationMode: 'chitchat',
      allTools,
      activatedCatalogToolNames: new Set(['device_automation']),
    });

    expect(result.required).toBe(true);
    if (!result.required) throw new Error('expected escalation');
    expect(result.blockedToolNames).toEqual(['device_automation']);
  });

  it('does not escalate for an everyday action chitchat is already authorized to call', () => {
    // Regression: escalating here moved the conversation to the agentic surface and goal
    // bootstrap for good, although chitchat's own authority already permitted the call.
    expect(
      detectChitchatModeEscalation({
        conversationMode: 'chitchat',
        allTools,
        activatedCatalogToolNames: new Set(['calendar_create_event']),
      }).required,
    ).toBe(false);
  });

  it('reports only the discovered tools that need agentic authority', () => {
    const result = detectChitchatModeEscalation({
      conversationMode: 'chitchat',
      allTools,
      activatedCatalogToolNames: new Set(['calendar_create_event', 'sessions_spawn']),
    });

    expect(result.required).toBe(true);
    if (!result.required) throw new Error('expected escalation');
    expect(result.blockedToolNames).toEqual(['sessions_spawn']);
  });

  it('does not escalate for grounded memory writes, which chitchat already owns', () => {
    expect(
      detectChitchatModeEscalation({
        conversationMode: 'chitchat',
        allTools,
        activatedCatalogToolNames: new Set(['memory_remember']),
      }).required,
    ).toBe(false);
  });

  it('does not escalate for a read-only discovery', () => {
    expect(
      detectChitchatModeEscalation({
        conversationMode: 'chitchat',
        allTools,
        activatedCatalogToolNames: new Set(['calendar_events']),
      }).required,
    ).toBe(false);
  });

  it('never escalates an agentic conversation, which already has the authority', () => {
    expect(
      detectChitchatModeEscalation({
        conversationMode: 'agentic',
        allTools,
        activatedCatalogToolNames: new Set(['sessions_spawn']),
      }).required,
    ).toBe(false);
  });

  it('ignores unknown activated tool names instead of guessing', () => {
    expect(
      detectChitchatModeEscalation({
        conversationMode: 'chitchat',
        allTools,
        activatedCatalogToolNames: new Set(['not_a_registered_tool']),
      }).required,
    ).toBe(false);
  });
});

describe('buildConversationModeEscalationDetail', () => {
  it('records the transition and cause for the graph audit trail', () => {
    const detail = buildConversationModeEscalationDetail({
      required: true,
      reason: 'agentic_capability_discovered',
      blockedToolNames: ['sessions_spawn'],
    });

    expect(detail).toBe(
      'from:chitchat,to:agentic,reason:agentic_capability_discovered,tools:sessions_spawn',
    );
  });
});
