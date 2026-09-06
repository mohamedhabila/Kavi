// ---------------------------------------------------------------------------
// Tests - useChatStore: updateMessageAttachments
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';
import type { Attachment } from '../../../src/types/attachment';

const makePdfAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'att-1',
  type: 'file',
  uri: 'file:///doc.pdf',
  name: 'doc.pdf',
  mimeType: 'application/pdf',
  size: 4096,
  ...overrides,
});

describe('useChatStore', () => {
  describe('updateMessageAttachments', () => {
    it('records a structured document-input refusal reason onto the attachment', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'user',
        content: 'Review this PDF',
        attachments: [makePdfAttachment()],
      });

      useChatStore.getState().updateMessageAttachments(convId, 'msg1', [
        makePdfAttachment({ documentInputRefusalReason: 'unsupported_provider' }),
      ]);

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].attachments?.[0]).toMatchObject({
        documentInputRefusalReason: 'unsupported_provider',
      });
    });

    it('records the exceeded byte ceiling alongside the size-limit refusal', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'user',
        content: 'Review this large PDF',
        attachments: [makePdfAttachment({ size: 40 * 1024 * 1024 })],
      });

      useChatStore.getState().updateMessageAttachments(convId, 'msg1', [
        makePdfAttachment({
          size: 40 * 1024 * 1024,
          documentInputRefusalReason: 'exceeds_size_limit',
          documentInputRefusalMaxBytes: 32 * 1024 * 1024,
        }),
      ]);

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.messages[0].attachments?.[0]).toMatchObject({
        documentInputRefusalReason: 'exceeds_size_limit',
        documentInputRefusalMaxBytes: 32 * 1024 * 1024,
      });
    });

    it('is a no-op when the attachments are already equal', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg1',
        role: 'user',
        content: 'Review this PDF',
        attachments: [makePdfAttachment({ documentInputRefusalReason: 'unsupported_provider' })],
      });

      const before = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)!.messages[0].attachments;

      useChatStore.getState().updateMessageAttachments(convId, 'msg1', [
        makePdfAttachment({ documentInputRefusalReason: 'unsupported_provider' }),
      ]);

      const after = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)!.messages[0].attachments;
      expect(after).toBe(before);
    });
  });
});
