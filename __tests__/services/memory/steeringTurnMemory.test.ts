import { resolveClosedTurnEndingAt } from '../../../src/services/memory/closedTurn';
import { resolvePriorUserMessageIdentity } from '../../../src/services/memory/priorUserMessageIdentity';
import type { Message } from '../../../src/types/message';

// A message sent while a run is working steers that run: the run reads it at its next
// step, so it belongs to the run's turn. Memory must see one turn — request, steer, final
// answer — and keep the steer's words, instead of treating the steer as a new request
// whose turn has no answer.

const FINAL = { kind: 'final', completionStatus: 'complete', finishReason: 'stop' } as const;
const TOOL_STEP = {
  kind: 'intermediate',
  completionStatus: 'complete',
  finishReason: 'tool_calls',
} as const;

function steeredConversation(): Message[] {
  return [
    { id: 'prior-user', role: 'user', content: 'What is the capital of Peru?', timestamp: 1 },
    {
      id: 'prior-final',
      role: 'assistant',
      content: 'Lima.',
      timestamp: 2,
      assistantMetadata: FINAL,
    },
    { id: 'request', role: 'user', content: 'Plan a dinner for my team.', timestamp: 3 },
    {
      id: 'tool-step',
      role: 'assistant',
      content: '',
      timestamp: 4,
      assistantMetadata: TOOL_STEP,
      toolCalls: [{ id: 'call-1', name: 'web_search', arguments: '{}', status: 'completed' }],
    },
    { id: 'call-1-result', role: 'tool', toolCallId: 'call-1', content: 'ok', timestamp: 5 },
    {
      id: 'steer',
      role: 'user',
      content: 'Also, my sister Amira is vegetarian.',
      timestamp: 6,
      steerOfRunId: 'run-1',
    },
    {
      id: 'final',
      role: 'assistant',
      content: 'Here is a dinner plan with vegetarian options.',
      timestamp: 7,
      assistantMetadata: FINAL,
    },
  ];
}

describe('memory over a steered turn', () => {
  it('closes the turn at the request that started the run, with the steer inside it', () => {
    expect(resolveClosedTurnEndingAt(steeredConversation(), 'final')).toMatchObject({
      status: 'resolved',
      user: { id: 'request' },
      steeringUsers: [{ id: 'steer' }],
      turnMessages: [
        { id: 'request' },
        { id: 'tool-step' },
        { id: 'call-1-result' },
        { id: 'steer' },
        { id: 'final' },
      ],
      sourceStartMessageId: 'request',
      sourceEndMessageId: 'final',
      priorUserMessageId: 'prior-user',
    });
  });

  it('opens a new turn at an unmarked user message', () => {
    const messages = steeredConversation().map(({ steerOfRunId: _steer, ...message }) => message);

    expect(resolveClosedTurnEndingAt(messages, 'final')).toMatchObject({
      status: 'resolved',
      sourceStartMessageId: 'steer',
      priorUserMessageId: 'request',
      steeringUsers: [],
    });
  });

  it('never names a steer as the prior user of the next turn', () => {
    const messages: Message[] = [
      ...steeredConversation(),
      { id: 'next', role: 'user', content: 'Thanks!', timestamp: 8 },
    ];

    expect(resolvePriorUserMessageIdentity(messages, 'next')).toEqual({
      status: 'resolved',
      priorUserMessageId: 'request',
    });
  });
});
