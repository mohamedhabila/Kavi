import { resolveMobileControllerRecoverySignal } from '../../src/engine/graph/foregroundRun/mobileControllerObservation';
import type { Message } from '../../src/types/message';

function outcomeMessage(
  sequence: number,
  observableDelta: 'changed' | 'unchanged',
): Message[] {
  const toolCallId = `mobile-call-${sequence}`;
  return [
    {
      id: `assistant-${sequence}`,
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: toolCallId,
          name: 'mobile_ui_action',
          arguments: JSON.stringify({ kind: 'wait', durationMs: 100 }),
          status: 'completed',
        },
      ],
      timestamp: sequence * 2,
    },
    {
      id: `tool-${sequence}`,
      role: 'tool',
      toolCallId,
      content: JSON.stringify({
        version: 1,
        executionState: 'completed',
        effectState: 'applied',
        verificationState: 'acknowledged',
        observableDelta,
      }),
      timestamp: sequence * 2 + 1,
    },
  ];
}

describe('mobile controller recovery signal', () => {
  const userMessage: Message = {
    id: 'user-1',
    role: 'user',
    content: '完成当前设备任务',
    timestamp: 1,
  };

  it('requires a strategy change after three correlated unchanged outcomes', () => {
    expect(
      resolveMobileControllerRecoverySignal([
        userMessage,
        ...outcomeMessage(1, 'unchanged'),
        ...outcomeMessage(2, 'unchanged'),
        ...outcomeMessage(3, 'unchanged'),
      ]),
    ).toEqual({
      version: 1,
      consecutiveUnchangedOutcomes: 3,
      requiredResponse: 'change_strategy_or_report_blocker',
    });
  });

  it('resets recovery pressure after an observed screen change', () => {
    expect(
      resolveMobileControllerRecoverySignal([
        userMessage,
        ...outcomeMessage(1, 'unchanged'),
        ...outcomeMessage(2, 'unchanged'),
        ...outcomeMessage(3, 'changed'),
      ]),
    ).toBeNull();
  });

  it('does not carry recovery pressure across a new user turn', () => {
    expect(
      resolveMobileControllerRecoverySignal([
        userMessage,
        ...outcomeMessage(1, 'unchanged'),
        ...outcomeMessage(2, 'unchanged'),
        ...outcomeMessage(3, 'unchanged'),
        { ...userMessage, id: 'user-2', timestamp: 20 },
      ]),
    ).toBeNull();
  });
});
