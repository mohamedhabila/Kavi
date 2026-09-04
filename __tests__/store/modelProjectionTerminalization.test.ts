import { terminalizeModelProjectionReservationConversation } from '../../src/store/modelProjectionTerminalization';
import { i18n } from '../../src/i18n/manager';
import type { Conversation, ModelProjectionOwner } from '../../src/types/conversation';

const owner: ModelProjectionOwner = {
  surface: 'foreground',
  runId: 'run-1',
  requestMessageId: 'request-1',
  assistantMessageId: 'assistant-1',
  controlEpoch: 0,
};

function makeConversation(): Conversation {
  return {
    id: 'conversation-1',
    title: 'Chat',
    providerId: 'provider-1',
    systemPrompt: '',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: '', timestamp: 2 },
    ],
  };
}

describe('terminalizeModelProjectionReservationConversation', () => {
  it('fills the interrupted assistant bubble with the English retry message by default', () => {
    const result = terminalizeModelProjectionReservationConversation({
      conversation: makeConversation(),
      owner,
      detail: 'app restarted mid-turn',
      finishReason: 'app_restarted_before_start',
      timestamp: 10,
    });

    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') throw new Error('expected applied result');
    const assistant = result.conversation.messages.find((m) => m.id === 'assistant-1');
    expect(assistant?.content).toBe(
      'Response interrupted when the app restarted before generation could start. Please retry when you are ready.',
    );
    expect(assistant?.isError).toBe(true);
    expect(result.conversation.logs?.[0]?.title).toBe('Response interrupted by app restart');
  });

  it('fills the assistant bubble with localized (non-English) text once the locale is switched to Arabic', async () => {
    await i18n.setLocale('ar');
    try {
      const result = terminalizeModelProjectionReservationConversation({
        conversation: makeConversation(),
        owner,
        detail: 'app restarted mid-turn',
        finishReason: 'app_restarted_before_start',
        timestamp: 10,
      });

      expect(result.kind).toBe('applied');
      if (result.kind !== 'applied') throw new Error('expected applied result');
      const assistant = result.conversation.messages.find((m) => m.id === 'assistant-1');
      expect(assistant?.content).not.toMatch(/Response interrupted/);
      expect(assistant?.content).toContain('تم إيقاف الرد بسبب إعادة تشغيل التطبيق');
      expect(result.conversation.logs?.[0]?.title).not.toBe('Response interrupted by app restart');
      expect(result.conversation.logs?.[0]?.title).toBe('تم إيقاف الرد بسبب إعادة تشغيل التطبيق');
    } finally {
      await i18n.setLocale('en');
    }
  });

  it('uses the cancellation copy for a cancelled-before-start reservation', () => {
    const result = terminalizeModelProjectionReservationConversation({
      conversation: makeConversation(),
      owner,
      detail: 'user stopped generation',
      finishReason: 'cancelled_before_start',
      timestamp: 10,
    });

    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') throw new Error('expected applied result');
    const assistant = result.conversation.messages.find((m) => m.id === 'assistant-1');
    expect(assistant?.content).toBe('Stopped before a response was generated.');
    expect(assistant?.isError).toBe(false);
  });
});
