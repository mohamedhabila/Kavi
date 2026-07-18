import { getAgentRunMessageSlice } from '../../src/services/agents/lifecycle/agentRunStateMachine';
import type { Message } from '../../src/types/message';

function message(
  id: string,
  role: Message['role'],
  content: string,
  finishReason?: 'request_clarification' | 'stop',
): Message {
  return {
    id,
    role,
    content,
    timestamp: Number(id.replace(/\D/gu, '')) || 1,
    ...(finishReason
      ? {
          assistantMetadata: {
            kind: 'final' as const,
            completionStatus: 'complete' as const,
            finishReason,
          },
        }
      : {}),
  } as Message;
}

describe('agent run clarification message scope', () => {
  it('keeps multilingual clarification replies in one run and stops at the next task', () => {
    const messages = [
      message('m1', 'user', 'アラームを設定して'),
      message('m2', 'assistant', '何時に設定しますか？', 'request_clarification'),
      message('m3', 'user', '午前7時半'),
      message('m4', 'assistant', '¿Qué etiqueta debo usar?', 'request_clarification'),
      message('m5', 'user', 'اكتبها صباح الخير'),
      message('m6', 'assistant', 'Done.', 'stop'),
      message('m7', 'user', 'Start a different task.'),
      message('m8', 'assistant', 'Different result.', 'stop'),
    ];

    expect(getAgentRunMessageSlice(messages, 'm1').map(({ id }) => id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
    ]);
  });
});
