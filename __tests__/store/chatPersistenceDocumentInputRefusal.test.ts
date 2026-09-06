// ---------------------------------------------------------------------------
// Tests — chat persistence: structured document-input refusal fields
// ---------------------------------------------------------------------------
// `Attachment.documentInputRefusalReason` / `documentInputRefusalMaxBytes` must survive the
// message-sanitizing pass `sanitizeConversationForPersistence` runs before writing a
// conversation to disk, and a legacy attachment written before these fields existed must still
// decode (round-trip) without either field appearing.

import { sanitizeConversationForPersistence } from '../../src/store/chatPersistence';
import { makeTestConversation as makeConversation, makeTestMessage as makeMessage } from '../helpers/factories';

describe('chat persistence — document-input refusal', () => {
  it('preserves a structured document-input refusal reason across persistence', () => {
    const conversation = makeConversation({
      messages: [
        makeMessage(1, {
          role: 'user',
          attachments: [
            {
              id: 'pdf-1',
              type: 'file',
              uri: 'file:///contract.pdf',
              name: 'contract.pdf',
              mimeType: 'application/pdf',
              size: 40 * 1024 * 1024,
              documentInputRefusalReason: 'exceeds_size_limit',
              documentInputRefusalMaxBytes: 32 * 1024 * 1024,
            },
          ],
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);

    expect(persisted.messages[0].attachments).toEqual([
      expect.objectContaining({
        id: 'pdf-1',
        documentInputRefusalReason: 'exceeds_size_limit',
        documentInputRefusalMaxBytes: 32 * 1024 * 1024,
      }),
    ]);
  });

  it('never persists a byte ceiling for an unsupported-provider refusal, which carries no limit', () => {
    const conversation = makeConversation({
      messages: [
        makeMessage(1, {
          role: 'user',
          attachments: [
            {
              id: 'pdf-2',
              type: 'file',
              uri: 'file:///report.pdf',
              name: 'report.pdf',
              mimeType: 'application/pdf',
              size: 4096,
              documentInputRefusalReason: 'unsupported_provider',
            },
          ],
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);

    expect(persisted.messages[0].attachments?.[0]).toMatchObject({
      documentInputRefusalReason: 'unsupported_provider',
    });
    expect(persisted.messages[0].attachments?.[0]).not.toHaveProperty(
      'documentInputRefusalMaxBytes',
    );
  });

  it('decodes a legacy attachment with no document-input refusal fields without error', () => {
    const conversation = makeConversation({
      messages: [
        makeMessage(1, {
          role: 'user',
          attachments: [
            {
              id: 'pdf-legacy',
              type: 'file',
              uri: 'file:///notes.pdf',
              name: 'notes.pdf',
              mimeType: 'application/pdf',
              size: 2048,
            },
          ],
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);

    expect(persisted.messages[0].attachments?.[0]).not.toHaveProperty(
      'documentInputRefusalReason',
    );
    expect(persisted.messages[0].attachments?.[0]).not.toHaveProperty(
      'documentInputRefusalMaxBytes',
    );
  });
});
