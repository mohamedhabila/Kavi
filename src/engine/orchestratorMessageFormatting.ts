import { extractGeminiToolCallThoughtSignature } from '../services/llm/core/reasoningExtraction';
import { borrowThoughtSignatureFromReplayParts } from '../services/llm/providers/gemini/contentParts';
import { buildImageAttachmentDataUri } from '../services/media/attachmentPayloads';
import { filterModelVisibleAttachments } from '../utils/messageAttachments';
import { normalizeToolName } from './tools/index';
import { Attachment } from '../types/attachment';
import { Message, MessageProviderReplay, ToolCall } from '../types/message';

type ApiMessage = {
  role: string;
  content: string | any[];
  tool_call_id?: string;
  name?: string;
  providerReplay?: MessageProviderReplay;
};

function formatAttachmentPromptSize(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }

  if (size < 1024) {
    return `${Math.round(size)} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function buildAttachmentPromptLine(attachment: Attachment): string {
  const label =
    attachment.name?.trim() ||
    (attachment.type === 'image'
      ? 'Attached image'
      : attachment.type === 'audio'
        ? 'Voice note'
        : 'Attached file');
  const metadata = [
    attachment.mimeType?.trim() || null,
    formatAttachmentPromptSize(attachment.size),
    attachment.workspacePath?.trim() ? `workspace: ${attachment.workspacePath.trim()}` : null,
  ].filter((value): value is string => Boolean(value));
  return metadata.length > 0 ? `${label} (${metadata.join(', ')})` : label;
}

function isPlainRecordValue(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripGeminiToolCallThoughtSignature(
  apiToolCall: Record<string, any>,
): Record<string, any> {
  const next = { ...apiToolCall };
  delete next.thoughtSignature;
  delete next.thought_signature;

  if (!isPlainRecordValue(next.extra_content)) {
    return next;
  }

  const extraContent = { ...next.extra_content };
  if (isPlainRecordValue(extraContent.google)) {
    const google = { ...extraContent.google };
    delete google.thought_signature;
    if (Object.keys(google).length > 0) {
      extraContent.google = google;
    } else {
      delete extraContent.google;
    }
  }

  if (Object.keys(extraContent).length > 0) {
    next.extra_content = extraContent;
  } else {
    delete next.extra_content;
  }

  return next;
}

function buildApiToolCalls(
  toolCalls: ToolCall[],
  providerReplay?: MessageProviderReplay,
): Record<string, any>[] {
  const replayParts = Array.isArray(providerReplay?.geminiParts)
    ? providerReplay.geminiParts.filter((part): part is Record<string, any> =>
        isPlainRecordValue(part),
      )
    : [];

  return toolCalls.map((toolCall, index) => {
    const apiToolCall = buildApiToolCall(toolCall);
    if (index > 0) {
      return stripGeminiToolCallThoughtSignature(apiToolCall);
    }

    if (extractGeminiToolCallThoughtSignature(apiToolCall)) {
      return apiToolCall;
    }

    const borrowedSignature = borrowThoughtSignatureFromReplayParts(replayParts, 0);
    if (!borrowedSignature) {
      return apiToolCall;
    }

    return {
      ...apiToolCall,
      thoughtSignature: borrowedSignature,
      extra_content: {
        ...(isPlainRecordValue(apiToolCall.extra_content) ? apiToolCall.extra_content : {}),
        google: { thought_signature: borrowedSignature },
      },
    };
  });
}

function buildApiToolCall(toolCall: ToolCall): Record<string, any> {
  const rawToolCall = isPlainRecordValue(toolCall.raw) ? toolCall.raw : undefined;
  const rawFunction = isPlainRecordValue(rawToolCall?.function) ? rawToolCall.function : undefined;
  const normalizedName = normalizeToolName(
    typeof rawFunction?.name === 'string' && rawFunction.name.length > 0
      ? rawFunction.name
      : toolCall.name,
  );

  return {
    ...(rawToolCall || {}),
    id:
      typeof rawToolCall?.id === 'string' && rawToolCall.id.length > 0
        ? rawToolCall.id
        : toolCall.id,
    type:
      typeof rawToolCall?.type === 'string' && rawToolCall.type.length > 0
        ? rawToolCall.type
        : 'function',
    function: {
      ...(rawFunction || {}),
      name: normalizedName,
      arguments:
        typeof rawFunction?.arguments === 'string' ? rawFunction.arguments : toolCall.arguments,
    },
  };
}

function getAnthropicReplayAssistantBlocks(
  providerReplay: Message['providerReplay'] | undefined,
): any[] | undefined {
  const replayBlocks = Array.isArray(providerReplay?.anthropicBlocks)
    ? providerReplay.anthropicBlocks
    : undefined;
  const hasToolCalls =
    Array.isArray(providerReplay?.anthropicBlocks) &&
    providerReplay.anthropicBlocks.some(
      (block) =>
        isPlainRecordValue(block) &&
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        block.id.trim().length > 0 &&
        typeof block.name === 'string' &&
        block.name.trim().length > 0,
    );

  const normalizeReplayBlocks = (blocks: any[]): any[] => {
    const normalizedBlocks = blocks.map((block) => {
      if (
        !isPlainRecordValue(block) ||
        block.type !== 'tool_use' ||
        typeof block.name !== 'string'
      ) {
        return block;
      }

      return {
        ...block,
        name: normalizeToolName(block.name),
      };
    });

    return hasToolCalls
      ? normalizedBlocks
      : normalizedBlocks.filter(
          (block) =>
            !isPlainRecordValue(block) ||
            (block.type !== 'thinking' && block.type !== 'redacted_thinking'),
        );
  };

  if (replayBlocks && replayBlocks.length > 0) {
    const normalizedReplayBlocks = normalizeReplayBlocks(replayBlocks);
    return normalizedReplayBlocks.length > 0 ? normalizedReplayBlocks : undefined;
  }

  return undefined;
}

function isAnthropicReplayableThinkingBlock(block: unknown): boolean {
  if (!isPlainRecordValue(block)) {
    return false;
  }

  if (block.type === 'thinking') {
    return typeof block.signature === 'string' && block.signature.length > 0;
  }

  return (
    block.type === 'redacted_thinking' && typeof block.data === 'string' && block.data.length > 0
  );
}

export function canContinueAnthropicThinking(messages: Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'system' || message.role === 'tool') {
      continue;
    }
    if (message.role === 'user') {
      return false;
    }
    if (message.role === 'assistant') {
      const assistantBlocks = getAnthropicReplayAssistantBlocks(message.providerReplay);
      return (
        Array.isArray(assistantBlocks) && assistantBlocks.some(isAnthropicReplayableThinkingBlock)
      );
    }
  }

  return false;
}

export async function formatMessagesForApi(
  systemPrompt: string,
  messages: Message[],
): Promise<ApiMessage[]> {
  const apiMessages: ApiMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === 'system') {
      apiMessages.push({ role: 'user', content: msg.content });
      continue;
    }
    const messageContent = msg.role === 'user' ? msg.enrichedContent || msg.content : msg.content;

    if (msg.role === 'tool') {
      const toolCallId = msg.toolCallId || msg.toolCalls?.[0]?.id || '';
      if (!toolCallId) {
        continue;
      }
      apiMessages.push({
        role: 'tool',
        content:
          typeof messageContent === 'string' && messageContent.length > 0
            ? messageContent
            : 'No output.',
        tool_call_id: toolCallId,
        name: msg.toolCalls?.[0]?.name,
        ...(msg.isError ? { is_error: true } : {}),
      } as any);
      continue;
    }

    if (msg.role === 'assistant') {
      const anthropicAssistantBlocks = getAnthropicReplayAssistantBlocks(msg.providerReplay);
      if (Array.isArray(anthropicAssistantBlocks) && anthropicAssistantBlocks.length > 0) {
        const assistantContent =
          anthropicAssistantBlocks.length === 1 &&
          isPlainRecordValue(anthropicAssistantBlocks[0]) &&
          anthropicAssistantBlocks[0].type === 'text' &&
          typeof anthropicAssistantBlocks[0].text === 'string'
            ? anthropicAssistantBlocks[0].text
            : anthropicAssistantBlocks;
        apiMessages.push({ role: 'assistant', content: assistantContent });
        continue;
      }
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      apiMessages.push({
        role: 'assistant',
        content: messageContent || '',
        ...(msg.providerReplay ? { providerReplay: msg.providerReplay } : {}),
        tool_calls: buildApiToolCalls(msg.toolCalls, msg.providerReplay),
      } as any);
      continue;
    }

    const modelVisibleAttachments = filterModelVisibleAttachments(msg.attachments);
    if (msg.role === 'user' && modelVisibleAttachments?.length) {
      const parts: any[] = [];
      if (typeof messageContent === 'string' && messageContent.trim().length > 0) {
        parts.push({ type: 'text', text: messageContent });
      }

      const summarizedAttachments: string[] = [];
      for (const attachment of modelVisibleAttachments) {
        if (attachment.type === 'image') {
          const dataUri = await buildImageAttachmentDataUri(attachment);
          if (dataUri) {
            parts.push({
              type: 'image_url',
              image_url: { url: dataUri },
            });
            continue;
          }

          parts.push({
            type: 'text',
            text: `Attached image: ${buildAttachmentPromptLine(attachment)}`,
          });
          continue;
        }

        summarizedAttachments.push(buildAttachmentPromptLine(attachment));
      }

      if (summarizedAttachments.length > 0) {
        parts.push({
          type: 'text',
          text: `Attached files:\n${summarizedAttachments.map((line) => `- ${line}`).join('\n')}`,
        });
      }

      apiMessages.push({ role: 'user', content: parts });
      continue;
    }

    apiMessages.push({
      role: msg.role,
      content: messageContent,
      ...(msg.role === 'assistant' && msg.providerReplay
        ? { providerReplay: msg.providerReplay }
        : {}),
    });
  }

  return apiMessages;
}
