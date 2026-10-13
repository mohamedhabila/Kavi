import { selectForegroundScenarioTurnMessages } from '../../src/acceptance/e2eAgent/foregroundScenarioDriverRuntime';
import type { Message } from '../../src/types/message';

// The driver took a turn's messages by the conversation's length before the turn. Once the
// live window moved older messages to the archive during the turn, that index pointed past
// the end and the turn's own user message read as "not persisted".

function message(id: string, role: Message['role']): Message {
  return { id, role, content: id, timestamp: 1 };
}

describe('selectForegroundScenarioTurnMessages', () => {
  it('finds the turn by its user message after older messages left the window', () => {
    // Three messages before the turn (u1, a1, u2); u1 and a1 left while it ran.
    const after = [message('u2', 'user'), message('u3', 'user'), message('a3', 'assistant')];

    expect(selectForegroundScenarioTurnMessages(after, 'u3').map((entry) => entry.id)).toEqual([
      'u3',
      'a3',
    ]);
  });

  it('is empty while the turn has no user message yet', () => {
    expect(selectForegroundScenarioTurnMessages([message('u1', 'user')], 'u2')).toEqual([]);
  });
});
