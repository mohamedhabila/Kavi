// ---------------------------------------------------------------------------
// Tests — Conversation Mode (Types + Store Integration)
// ---------------------------------------------------------------------------

import type { Conversation, ConversationMode } from '../../src/types/conversation';
import type { SubAgentConfig } from '../../src/types/subAgent';

describe('Conversation type with mode', () => {
  it('accepts mode field as agentic', () => {
    const conv: Partial<Conversation> = {
      id: 'test-1',
      mode: 'agentic',
    };
    expect(conv.mode).toBe('agentic');
  });

  it('accepts mode field as chitchat', () => {
    const conv: Partial<Conversation> = {
      id: 'test-2',
      mode: 'chitchat',
    };
    expect(conv.mode).toBe('chitchat');
  });

  it('mode is optional (undefined for legacy conversations)', () => {
    const conv: Partial<Conversation> = {
      id: 'test-3',
    };
    expect(conv.mode).toBeUndefined();
  });
});

describe('SubAgentConfig enhanced fields', () => {
  it('accepts systemPrompt field', () => {
    const config: SubAgentConfig = {
      parentConversationId: 'conv-1',
      prompt: 'Do work',
      systemPrompt: 'You are a specialist.',
    };
    expect(config.systemPrompt).toBe('You are a specialist.');
  });

  it('accepts name field', () => {
    const config: SubAgentConfig = {
      parentConversationId: 'conv-1',
      prompt: 'Do work',
      name: 'Backend Architect',
    };
    expect(config.name).toBe('Backend Architect');
  });

  it('accepts tools array field', () => {
    const config: SubAgentConfig = {
      parentConversationId: 'conv-1',
      prompt: 'Research',
      tools: ['web_search', 'web_fetch'],
    };
    expect(config.tools).toEqual(['web_search', 'web_fetch']);
  });

  it('all new fields are optional', () => {
    const config: SubAgentConfig = {
      parentConversationId: 'conv-1',
      prompt: 'Minimal config',
    };
    expect(config.systemPrompt).toBeUndefined();
    expect(config.name).toBeUndefined();
    expect(config.tools).toBeUndefined();
  });
});

describe('ConversationMode type', () => {
  it('agentic and direct are valid values', () => {
    const modes: ConversationMode[] = ['agentic', 'direct'];
    expect(modes).toHaveLength(2);
    expect(modes).toContain('agentic');
    expect(modes).toContain('direct');
  });
});
