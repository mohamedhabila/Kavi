import {
  resolvePriorUserMessageIdentity,
  resolveSealedPriorUserMessageIdentity,
} from '../../../src/services/memory/priorUserMessageIdentity';
import type { Message } from '../../../src/types/message';

const messages: Message[] = [
  { id: 'user-old', role: 'user', content: 'Old', timestamp: 1 },
  { id: 'assistant-old', role: 'assistant', content: 'Okay', timestamp: 2 },
  { id: 'tool-between', role: 'tool', content: 'Done', timestamp: 3 },
  { id: 'user-current', role: 'user', content: 'Current', timestamp: 4 },
];

describe('resolvePriorUserMessageIdentity', () => {
  it('returns only the nearest earlier user from exact persisted order', () => {
    expect(resolvePriorUserMessageIdentity(messages, 'user-current')).toEqual({
      status: 'resolved',
      priorUserMessageId: 'user-old',
    });
  });

  it.each(['missing', ' user-current', 'user-current '])(
    'does not repair or guess a non-exact current id: %s',
    (currentId) => {
      expect(resolvePriorUserMessageIdentity(messages, currentId)).toEqual(
        expect.objectContaining({ status: 'invalid' }),
      );
    },
  );

  it('rejects a non-user current message', () => {
    expect(resolvePriorUserMessageIdentity(messages, 'assistant-old')).toEqual({
      status: 'invalid',
      reason: 'current_message_not_user',
    });
  });

  it('rejects duplicate current-message identities', () => {
    expect(
      resolvePriorUserMessageIdentity(
        [...messages, { ...messages[3]!, content: 'Duplicate current identity' }],
        'user-current',
      ),
    ).toEqual({ status: 'invalid', reason: 'current_message_ambiguous' });
  });

  it('rejects a duplicate nearest-prior identity instead of rebinding by id', () => {
    expect(
      resolvePriorUserMessageIdentity(
        [{ id: 'user-old', role: 'user', content: 'Older duplicate', timestamp: 0 }, ...messages],
        'user-current',
      ),
    ).toEqual({ status: 'invalid', reason: 'prior_message_ambiguous' });
  });

  it('distinguishes a valid first user from invalid provenance', () => {
    expect(resolvePriorUserMessageIdentity(messages, 'user-old')).toEqual({
      status: 'resolved',
      priorUserMessageId: null,
    });
  });

  it('requires an explicitly sealed prior identity to equal the derived identity', () => {
    expect(resolveSealedPriorUserMessageIdentity(messages, 'user-current', 'user-old')).toEqual({
      status: 'resolved',
      priorUserMessageId: 'user-old',
    });
    expect(resolveSealedPriorUserMessageIdentity(messages, 'user-current', 'other-user')).toEqual({
      status: 'invalid',
    });
    expect(resolveSealedPriorUserMessageIdentity(messages, 'user-old', 'user-old')).toEqual({
      status: 'invalid',
    });
  });
});
