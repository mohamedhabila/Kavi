import { useChatStore } from '../../../src/store/useChatStore';
import { createScheduledJobOrchestratorCallbacks } from '../../../src/services/scheduler/jobExecutorCallbacks';
import { createScheduledJobRetryPolicy } from '../../../src/services/scheduler/jobExecutorRetryPolicy';
import { createAgentControlGraphTerminalOutcomeTracker } from '../../../src/engine/graph/terminalOutcome';
import type { Attachment } from '../../../src/types/attachment';

function buildPdfAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att-pdf',
    type: 'file',
    uri: 'file:///report.pdf',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    ...overrides,
  };
}

function buildImageAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att-image',
    type: 'image',
    uri: 'file:///photo.png',
    name: 'photo.png',
    mimeType: 'image/png',
    size: 512,
    ...overrides,
  };
}

function findMessage(conversationId: string, messageId: string) {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  return conversation?.messages.find((message) => message.id === messageId);
}

function buildCallbacksHandle(params: {
  conversationId: string;
  transcriptMutationAllowed: () => boolean;
}) {
  return createScheduledJobOrchestratorCallbacks({
    chatState: useChatStore.getState(),
    conversationId: params.conversationId,
    assistantMessageId: 'assistant-msg-1',
    transcriptMutationAllowed: params.transcriptMutationAllowed,
    retryPolicy: createScheduledJobRetryPolicy(new AbortController().signal),
    terminalOutcome: createAgentControlGraphTerminalOutcomeTracker(),
  });
}

describe('createScheduledJobOrchestratorCallbacks — onUserMessageAttachmentsUpdated', () => {
  let conversationId: string;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    useChatStore.setState({ conversations: [], activeConversationId: null, isLoading: false });
    conversationId = useChatStore.getState().createConversation('provider-1', 'Be helpful.');
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('persists a document-input refusal onto the matching attachment', () => {
    useChatStore.getState().addMessage(conversationId, {
      id: 'user-msg-1',
      role: 'user',
      content: 'Summarize this PDF',
      attachments: [buildPdfAttachment()],
    });

    const { callbacks } = buildCallbacksHandle({
      conversationId,
      transcriptMutationAllowed: () => true,
    });

    callbacks.onUserMessageAttachmentsUpdated?.('user-msg-1', [
      buildPdfAttachment({
        documentInputRefusalReason: 'exceeds_size_limit',
        documentInputRefusalMaxBytes: 33_554_432,
      }),
    ]);

    const message = findMessage(conversationId, 'user-msg-1');
    expect(message?.attachments).toHaveLength(1);
    expect(message?.attachments?.[0].documentInputRefusalReason).toBe('exceeds_size_limit');
    expect(message?.attachments?.[0].documentInputRefusalMaxBytes).toBe(33_554_432);
  });

  it('keeps a non-PDF attachment on the same message untouched by the refusal', () => {
    const imageAttachment = buildImageAttachment();
    const pdfAttachment = buildPdfAttachment();
    useChatStore.getState().addMessage(conversationId, {
      id: 'user-msg-2',
      role: 'user',
      content: 'Look at these two files',
      attachments: [imageAttachment, pdfAttachment],
    });

    const { callbacks } = buildCallbacksHandle({
      conversationId,
      transcriptMutationAllowed: () => true,
    });

    // Mirrors what `applyDocumentInputRefusals` in orchestratorRequestPreparation.ts hands the
    // callback: the full attachment array, with only the refused index changed.
    callbacks.onUserMessageAttachmentsUpdated?.('user-msg-2', [
      imageAttachment,
      { ...pdfAttachment, documentInputRefusalReason: 'unsupported_provider' },
    ]);

    const message = findMessage(conversationId, 'user-msg-2');
    expect(message?.attachments).toHaveLength(2);
    expect(message?.attachments?.[0]).toEqual(imageAttachment);
    expect(message?.attachments?.[0].documentInputRefusalReason).toBeUndefined();
    expect(message?.attachments?.[1].documentInputRefusalReason).toBe('unsupported_provider');
  });

  it('does not write when transcriptMutationAllowed() is false, and logs the skip', () => {
    useChatStore.getState().addMessage(conversationId, {
      id: 'user-msg-3',
      role: 'user',
      content: 'Summarize this PDF',
      attachments: [buildPdfAttachment()],
    });

    const { callbacks } = buildCallbacksHandle({
      conversationId,
      transcriptMutationAllowed: () => false,
    });

    callbacks.onUserMessageAttachmentsUpdated?.('user-msg-3', [
      buildPdfAttachment({ documentInputRefusalReason: 'exceeds_size_limit' }),
    ]);

    const message = findMessage(conversationId, 'user-msg-3');
    expect(message?.attachments?.[0].documentInputRefusalReason).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dropped a document-input refusal update'),
      expect.objectContaining({ conversationId, messageId: 'user-msg-3' }),
    );
  });
});
