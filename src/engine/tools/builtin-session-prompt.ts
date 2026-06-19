import { generateId } from '../../utils/id';
import type { Message } from '../../types/message';
import { stripAttachmentPayloads } from '../../utils/messageAttachments';

export function findLatestUserMessageWithAttachments(messages?: Message[]): Message | undefined {
  if (!messages?.length) {
    return undefined;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && (message.attachments?.length || 0) > 0) {
      return message;
    }
  }

  return undefined;
}

export function buildDelegatedInitialMessages(
  prompt: string,
  sourceMessage: Message | undefined,
): Message[] | undefined {
  const attachments = stripAttachmentPayloads(sourceMessage?.attachments);
  if (!attachments?.length) {
    return undefined;
  }

  return [
    {
      id: generateId(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      attachments,
    },
  ];
}

function normalizeOptionalSessionText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeDelegatedWorkerPrompt(args: { prompt?: unknown }): {
  value?: string;
  error?: string;
} {
  const prompt = normalizeOptionalSessionText(args.prompt);
  if (!prompt) {
    return { error: 'Worker prompt must be a non-empty string.' };
  }

  return { value: prompt };
}

export function normalizeRequiredSessionText(
  value: unknown,
  fieldName: 'prompt' | 'message',
): { value?: string; error?: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: `Worker ${fieldName} must be a non-empty string.` };
  }

  return { value };
}
