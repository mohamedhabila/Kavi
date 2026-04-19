// ---------------------------------------------------------------------------
// Tests — Conversation Helpers
// ---------------------------------------------------------------------------

import { isPlaceholderTitle, generateConversationTitle } from '../../src/utils/conversation';

describe('isPlaceholderTitle', () => {
  it('should return true for "New Chat"', () => {
    expect(isPlaceholderTitle('New Chat')).toBe(true);
  });

  it('should return true for localized default titles from other locales', () => {
    expect(isPlaceholderTitle('Nueva conversación')).toBe(true);
    expect(isPlaceholderTitle('Neues Gespräch')).toBe(true);
  });

  it('should return true for "Untitled"', () => {
    expect(isPlaceholderTitle('Untitled')).toBe(true);
  });

  it('should return true for empty string', () => {
    expect(isPlaceholderTitle('')).toBe(true);
  });

  it('should return true for whitespace-only string', () => {
    expect(isPlaceholderTitle('   ')).toBe(true);
  });

  it('should return false for real titles', () => {
    expect(isPlaceholderTitle('My conversation')).toBe(false);
  });

  it('should return false for partial matches', () => {
    expect(isPlaceholderTitle('New Chat 2')).toBe(false);
  });
});

describe('generateConversationTitle', () => {
  it('should return "New Conversation" for empty input', () => {
    expect(generateConversationTitle('')).toBe('New Conversation');
  });

  it('should return "New Conversation" for null-ish input', () => {
    expect(generateConversationTitle(null as any)).toBe('New Conversation');
  });

  it('should return "New Conversation" for whitespace', () => {
    expect(generateConversationTitle('   ')).toBe('New Conversation');
  });

  it('should return short messages as-is', () => {
    expect(generateConversationTitle('Hello world')).toBe('Hello world');
  });

  it('should truncate messages over 50 chars', () => {
    const longMessage = 'a'.repeat(60);
    const result = generateConversationTitle(longMessage);
    expect(result.length).toBe(50);
    expect(result.endsWith('...')).toBe(true);
  });

  it('should collapse newlines to spaces', () => {
    expect(generateConversationTitle('Hello\nworld')).toBe('Hello world');
  });

  it('should handle exactly 50 chars', () => {
    const msg = 'a'.repeat(50);
    expect(generateConversationTitle(msg)).toBe(msg);
  });

  it('should trim leading/trailing whitespace', () => {
    expect(generateConversationTitle('  Hello  ')).toBe('Hello');
  });
});
