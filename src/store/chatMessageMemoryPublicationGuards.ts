import type { Message, MessageMemoryPublicationDisposition, ToolCall } from '../types/message';
import { isExactMemoryProvenanceId } from '../services/memory/memoryProvenanceIdentity';
import {
  isEligibleMessageMemoryPublicationSource,
  normalizeMessageMemoryPublication,
} from '../utils/messageMemoryPublication';

const OPEN_PUBLICATION_DISPOSITIONS = new Set<MessageMemoryPublicationDisposition>([null]);
const MUTATION_LOCKING_PUBLICATION_DISPOSITIONS = new Set<MessageMemoryPublicationDisposition>([
  null,
  'enqueued',
]);

function fail(code: string): never {
  throw new Error(code);
}

function validateUniqueMessageIdentities(messages: readonly Message[]): void {
  const ids = new Set<string>();
  for (const message of messages) {
    if (!isExactMemoryProvenanceId(message.id) || ids.has(message.id)) {
      fail('chat_message_memory_publication_identity_invalid');
    }
    ids.add(message.id);
  }
}

function assertCompletePublicationFinal(messages: readonly Message[], finalIndex: number): void {
  const final = messages[finalIndex];
  if (!final || !isEligibleMessageMemoryPublicationSource(final)) {
    fail('chat_message_memory_publication_source_invalid');
  }

  for (let index = finalIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    const role = message?.role;
    if (role === 'user') return;
    if ((role === 'assistant' && !message?.subAgentEvent) || role === 'tool') {
      fail('chat_message_memory_publication_turn_not_terminal');
    }
  }
}

function findTurnStartIndex(messages: readonly Message[], finalIndex: number): number {
  for (let index = finalIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return 0;
}

function getPublicationTurnMessageIds(
  messages: readonly Message[],
  dispositions: ReadonlySet<MessageMemoryPublicationDisposition>,
): ReadonlySet<string> {
  const publicationFinalIndices: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const publication = normalizeMessageMemoryPublication(messages[index]?.memoryPublication);
    if (publication && dispositions.has(publication.disposition)) {
      publicationFinalIndices.push(index);
    }
  }
  if (publicationFinalIndices.length === 0) return new Set<string>();

  validateUniqueMessageIdentities(messages);
  const protectedIds = new Set<string>();

  for (const finalIndex of publicationFinalIndices) {
    assertCompletePublicationFinal(messages, finalIndex);
    const startIndex = findTurnStartIndex(messages, finalIndex);
    for (let index = startIndex; index <= finalIndex; index += 1) {
      protectedIds.add(messages[index]!.id);
    }
  }

  return protectedIds;
}

/** Exact source windows whose durable memory publication is still unresolved. */
export function getOpenMemoryPublicationTurnMessageIds(
  messages: readonly Message[],
): ReadonlySet<string> {
  return getPublicationTurnMessageIds(messages, OPEN_PUBLICATION_DISPOSITIONS);
}

/**
 * Source windows that must remain immutable while publication is open or after an
 * immutable ingestion snapshot has been enqueued.
 */
export function getMemoryPublicationMutationLockedMessageIds(
  messages: readonly Message[],
): ReadonlySet<string> {
  return getPublicationTurnMessageIds(messages, MUTATION_LOCKING_PUBLICATION_DISPOSITIONS);
}

interface IngestionRelevantToolCall {
  id: ToolCall['id'];
  name: ToolCall['name'];
  arguments: ToolCall['arguments'];
  status: ToolCall['status'];
  result: ToolCall['result'];
  error: ToolCall['error'];
}

interface IngestionRelevantMessage {
  id: Message['id'];
  role: Message['role'];
  content: Message['content'];
  timestamp: Message['timestamp'];
  enrichedContent: Message['enrichedContent'];
  toolCalls: IngestionRelevantToolCall[] | undefined;
  toolCallId: Message['toolCallId'];
  hasAttachments: boolean;
  isError: boolean;
  assistantMetadata:
    | {
        kind: NonNullable<Message['assistantMetadata']>['kind'];
        completionStatus: NonNullable<Message['assistantMetadata']>['completionStatus'];
        finishReason: NonNullable<Message['assistantMetadata']>['finishReason'];
      }
    | undefined;
}

function projectIngestionRelevantMessage(message: Message): IngestionRelevantMessage {
  const metadata = message.assistantMetadata;
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    enrichedContent: message.enrichedContent,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      status: toolCall.status,
      result: toolCall.result,
      error: toolCall.error,
    })),
    toolCallId: message.toolCallId,
    hasAttachments: (message.attachments?.length ?? 0) > 0,
    isError: message.isError === true,
    assistantMetadata: metadata
      ? {
          kind: metadata.kind,
          completionStatus: metadata.completionStatus,
          finishReason: metadata.finishReason,
        }
      : undefined,
  };
}

/** Compare exactly the fields captured by an immutable ingestion source snapshot. */
export function areMemoryIngestionSnapshotRelevantFieldsEqual(
  left: Message,
  right: Message,
): boolean {
  return (
    JSON.stringify(projectIngestionRelevantMessage(left)) ===
    JSON.stringify(projectIngestionRelevantMessage(right))
  );
}

/**
 * Keep the first message, every unresolved publication source window, and the
 * newest unprotected messages that fit. Selection is stable and duplicate-free.
 */
export function selectMessagesForPersistenceWithOpenMemoryPublicationTurns(
  messages: readonly Message[],
  maxMessages: number,
): Message[] {
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1) {
    return fail('chat_message_persistence_limit_invalid');
  }
  if (messages.length === 0) return [];

  const openTurnIds = getOpenMemoryPublicationTurnMessageIds(messages);
  const selectedIndices = new Set<number>([0]);
  if (openTurnIds.size > 0) {
    for (let index = 0; index < messages.length; index += 1) {
      if (openTurnIds.has(messages[index]!.id)) selectedIndices.add(index);
    }
  }
  if (selectedIndices.size > maxMessages) {
    return fail('chat_message_persistence_protected_messages_exceed_limit');
  }

  for (
    let index = messages.length - 1;
    index >= 0 && selectedIndices.size < maxMessages;
    index -= 1
  ) {
    selectedIndices.add(index);
  }
  return messages.filter((_message, index) => selectedIndices.has(index));
}
