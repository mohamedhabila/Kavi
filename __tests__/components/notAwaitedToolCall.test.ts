import { getToolCallFailurePresentation } from '../../src/components/chat/toolCallOutcomePresentation';
import type { ToolCall } from '../../src/types/message';

// Traced on-device. A research run finished successfully via web_fetch while a slow
// web_search was still in flight. The blanket reaper at run termination rewrote it to
// `failed` with "Tool call did not complete before the run reached a terminal state", so
// a successful run showed the user a red failure for something that never failed.
const call = (failureKind?: ToolCall['failureKind']): ToolCall => ({
  id: '1',
  name: 'web_search',
  arguments: '{}',
  status: 'failed',
  ...(failureKind ? { failureKind } : {}),
  error: 'Tool call did not complete before the run reached a terminal state.',
});

describe('a call the run never waited for is not shown as a failure', () => {
  it('reads as neutral rather than danger', () => {
    const presentation = getToolCallFailurePresentation(call('not_awaited'));

    expect(presentation.tone).toBe('warning');
    expect(presentation.titleKey).toBe('toolCall.outcomes.notAwaitedTitle');
  });

  it('still shows a real failure in danger', () => {
    expect(getToolCallFailurePresentation(call('tool_error')).tone).toBe('danger');
    expect(getToolCallFailurePresentation(call('runtime_error')).tone).toBe('danger');
  });

  it('leaves an unclassified failure alone', () => {
    expect(getToolCallFailurePresentation(call()).tone).toBe('danger');
  });
});
