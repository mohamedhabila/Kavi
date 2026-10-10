import { isContinuableStop } from '../../../src/screens/chatScreen/continuableStop';
import type { AgentRun } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';

// A long task handed back unfinished — at the step limit, after repeating itself, or at
// the foreground work window — can be carried on with one tap.

function final(finishReason: string): Message {
  return {
    id: 'a1',
    role: 'assistant',
    content: 'Here is where I got to.',
    timestamp: 1,
    assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason },
  } as Message;
}

function runEndingWith(forcedTextReason?: string): AgentRun {
  return {
    controlGraph: { turnDirectives: { forceFinalText: true, forcedTextReason } },
  } as AgentRun;
}

describe('isContinuableStop', () => {
  it.each(['max_iterations', 'loop_detected'])('offers to continue after %s', (reason) => {
    expect(isContinuableStop(final(reason))).toBe(true);
  });

  it('offers to continue after the foreground work window', () => {
    expect(isContinuableStop(final('stop'), runEndingWith('foreground_budget_checkpoint'))).toBe(
      true,
    );
  });

  it('does not offer it for a finished answer', () => {
    expect(isContinuableStop(final('stop'), runEndingWith('workflow_route_completed'))).toBe(false);
    expect(isContinuableStop(final('stop'))).toBe(false);
  });

  it('does not offer it for anything but a final answer', () => {
    expect(isContinuableStop({ role: 'user' } as Message)).toBe(false);
    expect(
      isContinuableStop({
        role: 'assistant',
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'max_iterations',
        },
      } as Message),
    ).toBe(false);
  });
});
