import { executeToolInner as executeTool } from '../../src/engine/tools/toolDispatchRouter';
import { useChatStore } from '../../src/store/useChatStore';

export async function remember(input: {
  subject: string;
  predicate: string;
  value: string;
  messageId: string;
  messageText: string;
  subjectType?: 'self' | 'person' | 'project' | 'concept' | 'system';
  scope?: 'global' | 'conversation';
  threadId?: string;
  memoryConversationId?: string;
  priorUserMessage?: { id: string; text: string };
  extraArgs?: Record<string, unknown>;
}) {
  const threadId = input.threadId ?? 'thread-a';
  const memoryConversationId = input.memoryConversationId ?? 'memory-root-a';
  if (input.priorUserMessage) {
    useChatStore.setState({
      conversations: [
        {
          id: threadId,
          title: 'Grounded memory test',
          messages: [
            {
              id: input.priorUserMessage.id,
              role: 'user',
              content: input.priorUserMessage.text,
              timestamp: 1,
            },
            { id: input.messageId, role: 'user', content: input.messageText, timestamp: 2 },
          ],
          providerId: 'test-provider',
          systemPrompt: '',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    } as never);
  }
  return JSON.parse(
    await executeTool(
      'memory_remember',
      JSON.stringify({
        subject: input.subject,
        ...(input.subjectType ? { subjectType: input.subjectType } : {}),
        predicate: input.predicate,
        value: input.value,
        scope: input.scope ?? 'conversation',
        ...input.extraArgs,
      }),
      threadId,
      {
        memoryConversationId,
        currentUserMessage: { id: input.messageId, text: input.messageText },
      },
    ),
  ) as Record<string, any>;
}

export async function recall(input: {
  subject: string;
  predicate: string;
  threadId?: string;
  memoryConversationId?: string;
}) {
  return JSON.parse(
    await executeTool(
      'memory_recall',
      JSON.stringify({ subject: input.subject, predicate: input.predicate }),
      input.threadId ?? 'thread-a',
      { memoryConversationId: input.memoryConversationId ?? 'memory-root-a' },
    ),
  ) as Record<string, any>;
}
