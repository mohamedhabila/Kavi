import {
  buildConversationModeEscalationDetail,
  detectChitchatBudgetEscalation,
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

const allTools = [calendarCreate, memoryWrite, calendarRead];

describe('detectChitchatModeEscalation', () => {
  it('escalates when chitchat discovers a tool that mutates non-memory state', () => {
    const result = detectChitchatModeEscalation({
      conversationMode: 'chitchat',
      allTools,
      activatedCatalogToolNames: new Set(['calendar_create_event']),
    });

    expect(result.required).toBe(true);
    if (!result.required) throw new Error('expected escalation');
    expect(result.reason).toBe('side_effect_capability_discovered');
    expect(result.blockedToolNames).toEqual(['calendar_create_event']);
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
        activatedCatalogToolNames: new Set(['calendar_create_event']),
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

describe('detectChitchatBudgetEscalation', () => {
  it('escalates a chitchat run that exhausts its budget with work still open', () => {
    const result = detectChitchatBudgetEscalation({
      conversationMode: 'chitchat',
      iteration: 25,
      maxToolIterations: 25,
      hasUnfinishedWork: true,
    });

    expect(result.required).toBe(true);
    if (!result.required) throw new Error('expected escalation');
    expect(result.reason).toBe('iteration_budget_exhausted');
  });

  it('does not escalate when the run finished inside its budget', () => {
    expect(
      detectChitchatBudgetEscalation({
        conversationMode: 'chitchat',
        iteration: 25,
        maxToolIterations: 25,
        hasUnfinishedWork: false,
      }).required,
    ).toBe(false);
  });

  it('does not escalate before the budget is actually exhausted', () => {
    expect(
      detectChitchatBudgetEscalation({
        conversationMode: 'chitchat',
        iteration: 10,
        maxToolIterations: 25,
        hasUnfinishedWork: true,
      }).required,
    ).toBe(false);
  });
});

describe('buildConversationModeEscalationDetail', () => {
  it('records the transition and cause for the graph audit trail', () => {
    const detail = buildConversationModeEscalationDetail({
      required: true,
      reason: 'side_effect_capability_discovered',
      blockedToolNames: ['calendar_create_event'],
    });

    expect(detail).toBe(
      'from:chitchat,to:agentic,reason:side_effect_capability_discovered,tools:calendar_create_event',
    );
  });
});
