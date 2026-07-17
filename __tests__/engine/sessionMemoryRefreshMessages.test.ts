import {
  captureSessionInternalUserMessages,
  rebuildSessionMemoryRefreshMessages,
} from '../../src/engine/orchestrator/sessionMemoryRefreshMessages';
import type { Message } from '../../src/types/message';

const visibleArabic: Message = {
  id: 'visible-ar',
  role: 'user',
  content: 'تابع المهمة الحالية',
  timestamp: 1,
};
const internalJapanese: Message = {
  id: 'internal-ja',
  role: 'user',
  content: '内部制御メッセージ',
  timestamp: 2,
};

describe('session memory refresh messages', () => {
  it('restores exact internal users in code-owned order for gateway exclusion', () => {
    const internal = captureSessionInternalUserMessages(
      [
        visibleArabic,
        { id: 'assistant', role: 'assistant', content: '進行中', timestamp: 2 },
        internalJapanese,
      ],
      1,
    );

    const rebuilt = rebuildSessionMemoryRefreshMessages({
      internalUserMessages: internal,
      workingMessages: [visibleArabic],
    });

    expect(rebuilt).toEqual([visibleArabic, internalJapanese]);
    expect(internal).toHaveLength(1);
    expect(internal[0]?.id).toBe('internal-ja');
  });

  it('fails closed when the declared internal count has no exact owner', () => {
    expect(() => captureSessionInternalUserMessages([visibleArabic], 2)).toThrow(
      'internal_user_message_count_mismatch',
    );
  });

  it('fails closed on duplicate or mismatched message identities', () => {
    expect(() =>
      captureSessionInternalUserMessages([visibleArabic, { ...visibleArabic }], 1),
    ).toThrow('internal_user_message_identity_ambiguous');

    expect(() =>
      rebuildSessionMemoryRefreshMessages({
        internalUserMessages: [internalJapanese],
        workingMessages: [{ ...internalJapanese, content: '別の内容' }],
      }),
    ).toThrow('internal_user_message_identity_mismatch');
  });
});
