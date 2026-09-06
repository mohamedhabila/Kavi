// ---------------------------------------------------------------------------
// Tests — formatMessagesForApi: PDF attachments → provider-native content
// ---------------------------------------------------------------------------

import { formatMessagesForApi } from '../../src/engine/orchestratorMessageFormatting';
import { i18n } from '../../src/i18n/manager';
import type { Attachment } from '../../src/types/attachment';
import type { Message } from '../../src/types/message';
import type { LlmProviderConfig } from '../../src/types/provider';
import {
  ANTHROPIC_DOCUMENT_MAX_BYTES,
  OPENAI_RESPONSES_DOCUMENT_MAX_BYTES,
} from '../../src/services/llm/catalog/documentCapabilities';

const legacyFileSystem = jest.requireMock('expo-file-system/legacy') as {
  readAsStringAsync: jest.Mock;
};

beforeEach(async () => {
  legacyFileSystem.readAsStringAsync.mockReset();
  legacyFileSystem.readAsStringAsync.mockResolvedValue('cGRmLWJ5dGVz');
  await i18n.setLocale('en');
});

function makeProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'test',
    name: 'Test Provider',
    baseUrl: 'https://api.test.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    enabled: true,
    ...overrides,
  };
}

function makePdfAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'pdf1',
    type: 'file',
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    uri: 'file:///invoice.pdf',
    size: 2048,
    ...overrides,
  };
}

function userMessageWithAttachment(attachment: Attachment, content = 'Please review'): Message {
  return {
    id: 'u1',
    role: 'user',
    content,
    timestamp: Date.now(),
    attachments: [attachment],
  };
}

describe('formatMessagesForApi — PDF attachments', () => {
  it('embeds the document as a provider-native file content part when the model supports it', async () => {
    const provider = makeProvider({
      protocol: 'anthropic-messages',
      modelCapabilities: { 'test-model': { vision: false, tools: true, fileInput: true } },
    });

    const apiMessages = await formatMessagesForApi(
      'System prompt',
      [userMessageWithAttachment(makePdfAttachment())],
      { provider, model: 'test-model' },
    );

    const userMessage = apiMessages.find((message) => message.role === 'user');
    const documentPart = (userMessage?.content as any[]).find((part) => part.type === 'file');
    expect(documentPart).toEqual({
      type: 'file',
      file_data: 'data:application/pdf;base64,cGRmLWJ5dGVz',
      filename: 'invoice.pdf',
    });
  });

  it('omits the file part entirely for a non-PDF attachment, keeping the summary line', async () => {
    const provider = makeProvider({
      protocol: 'anthropic-messages',
      modelCapabilities: { 'test-model': { vision: false, tools: true, fileInput: true } },
    });
    const nonPdfAttachment: Attachment = {
      id: 'f1',
      type: 'file',
      name: 'notes.md',
      mimeType: 'text/markdown',
      uri: 'file:///notes.md',
      size: 128,
    };

    const apiMessages = await formatMessagesForApi(
      'System prompt',
      [userMessageWithAttachment(nonPdfAttachment)],
      { provider, model: 'test-model' },
    );

    const userMessage = apiMessages.find((message) => message.role === 'user');
    const content = userMessage?.content as any[];
    expect(content.some((part) => part.type === 'file')).toBe(false);
    expect(content.some((part) => part.type === 'text' && part.text.includes('notes.md'))).toBe(
      true,
    );
  });

  it('falls back to a localized notice when no capability context is provided', async () => {
    const apiMessages = await formatMessagesForApi('System prompt', [
      userMessageWithAttachment(makePdfAttachment()),
    ]);

    const userMessage = apiMessages.find((message) => message.role === 'user');
    const content = userMessage?.content as any[];
    expect(content.some((part) => part.type === 'file')).toBe(false);
    const notice = content.find(
      (part) => part.type === 'text' && part.text.includes('invoice.pdf'),
    );
    expect(notice?.text).toBe(i18n.t('mediaUnderstanding.documentUnsupportedProvider', {
      name: 'invoice.pdf',
    }));
  });

  it('falls back to a localized notice when the provider/model has no document capability', async () => {
    const provider = makeProvider({
      protocol: 'openai-chat',
      modelCapabilities: { 'test-model': { vision: true, tools: true, fileInput: true } },
    });

    const apiMessages = await formatMessagesForApi(
      'System prompt',
      [userMessageWithAttachment(makePdfAttachment())],
      { provider, model: 'test-model' },
    );

    const userMessage = apiMessages.find((message) => message.role === 'user');
    const content = userMessage?.content as any[];
    expect(content.some((part) => part.type === 'file')).toBe(false);
    const notice = content.find((part) => part.type === 'text' && part.text.includes('invoice.pdf'));
    expect(notice).toBeDefined();
  });

  it('refuses an oversized PDF with a localized size-limit notice instead of embedding it', async () => {
    const provider = makeProvider({
      protocol: 'anthropic-messages',
      modelCapabilities: { 'test-model': { vision: false, tools: true, fileInput: true } },
    });
    const oversizedRawBytes = Math.ceil(ANTHROPIC_DOCUMENT_MAX_BYTES / (4 / 3)) + 1;

    const apiMessages = await formatMessagesForApi(
      'System prompt',
      [userMessageWithAttachment(makePdfAttachment({ size: oversizedRawBytes }))],
      { provider, model: 'test-model' },
    );

    const userMessage = apiMessages.find((message) => message.role === 'user');
    const content = userMessage?.content as any[];
    expect(content.some((part) => part.type === 'file')).toBe(false);
    const notice = content.find((part) => part.type === 'text' && part.text.includes('invoice.pdf'));
    expect(notice?.text).toBe(
      i18n.t('mediaUnderstanding.documentExceedsSizeLimit', { name: 'invoice.pdf', limit: '32 MB' }),
    );
  });

  it('embeds the document for OpenAI Responses using its own documented limit', async () => {
    const provider = makeProvider({
      protocol: 'openai-responses',
      modelCapabilities: { 'test-model': { vision: true, tools: true, fileInput: true } },
    });

    const apiMessages = await formatMessagesForApi(
      'System prompt',
      [userMessageWithAttachment(makePdfAttachment())],
      { provider, model: 'test-model' },
    );

    const userMessage = apiMessages.find((message) => message.role === 'user');
    const documentPart = (userMessage?.content as any[]).find((part) => part.type === 'file');
    expect(documentPart?.file_data).toBe('data:application/pdf;base64,cGRmLWJ5dGVz');
    expect(OPENAI_RESPONSES_DOCUMENT_MAX_BYTES).toBeGreaterThan(0);
  });
});
