// ---------------------------------------------------------------------------
// Tests — summarizeToolCall session tool summaries
// ---------------------------------------------------------------------------
//
// Split out of ToolCallDisplay.test.tsx to stay under the maintainability line
// limit. Component-rendering coverage lives there; the presentation-helper
// coverage lives in ToolCallDisplay.presentationHelpers.test.ts. All three share
// fixtures from __tests__/helpers/toolCallDisplayFixtures.ts.

import { summarizeToolCall } from '../../src/components/chat/toolCallPresentation';
import { makeToolCall } from '../helpers/toolCallDisplayFixtures';

describe('summarizeToolCall — session tools', () => {
  it('summarizes sessions_spawn with agent name', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_spawn',
        arguments: JSON.stringify({ prompt: 'Implement the backend', name: 'Backend Architect' }),
      }),
    );
    expect(summary).toBe('🧠 Spawning agent: Backend Architect');
  });

  it('summarizes sessions_spawn without name', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_spawn',
        arguments: JSON.stringify({ prompt: 'Do some work' }),
      }),
    );
    expect(summary).toBe('🧠 Spawning sub-agent');
  });

  it('summarizes blocking sessions_spawn', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_spawn',
        arguments: JSON.stringify({ prompt: 'Do work', name: 'Worker', waitForCompletion: true }),
      }),
    );
    expect(summary).toBe('🧠 Spawning agent: Worker (blocking)');
  });

  it('summarizes sessions_status with truncated session ID', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_status',
        arguments: JSON.stringify({ sessionId: 'sub-1234567890-abcdef' }),
      }),
    );
    expect(summary).toBe('Checking agent sub-12345678…');
  });

  it('summarizes sessions_list', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_list',
        arguments: '{}',
      }),
    );
    expect(summary).toBe('Listing active agents');
  });

  it('summarizes sessions_send', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_send',
        arguments: JSON.stringify({ sessionId: 'sub-001-xyz', message: 'Iterate on the design' }),
      }),
    );
    expect(summary).toBe('Messaging agent sub-001-xyz…');
  });

  it('summarizes blocking sessions_send', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_send',
        arguments: JSON.stringify({
          sessionId: 'sub-001-xyz',
          message: 'Iterate on the design',
          waitForCompletion: true,
        }),
      }),
    );
    expect(summary).toBe('Messaging agent sub-001-xyz… (blocking)');
  });

  it('summarizes sessions_history', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_history',
        arguments: JSON.stringify({ sessionId: 'sub-999-abc' }),
      }),
    );
    expect(summary).toBe('Reading agent sub-999-abc… history');
  });

  it('summarizes sessions_output', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_output',
        arguments: JSON.stringify({ sessionId: 'sub-999-abc' }),
      }),
    );
    expect(summary).toBe('Reading final output from agent sub-999-abc…');
  });

  it('summarizes sessions_wait', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_wait',
        arguments: JSON.stringify({ sessionId: 'sub-999-abcdef', waitTimeoutMs: 5000 }),
      }),
    );
    expect(summary).toBe('Waiting on agent sub-999-abcd…');
  });

  it('summarizes sessions_cancel', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_cancel',
        arguments: JSON.stringify({ sessionId: 'sub-999-abc' }),
      }),
    );
    expect(summary).toBe('Stopping agent sub-999-abc…');
  });

  it('summarizes sessions_yield', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_yield',
        arguments: '{}',
      }),
    );
    expect(summary).toBe('⏸ Recording agent checkpoint');
  });
});
