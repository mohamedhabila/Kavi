import type { ChatState } from './chatStoreTypes';

export const CHAT_STORE_VERSION = 8;

const RETIRED_COMPACTION_PROFILE_CONTEXT_MIGRATION_VERSION = 8;
const RETIRED_COMPACTION_PROFILE_CONTEXT_PREFIX = '\n\n## Persistent Context\n';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function removeRetiredCompactionProfileContextFromMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;

  return messages.flatMap((value) => {
    if (!isRecord(value)) return [value];
    if (
      value.role !== 'system' ||
      typeof value.id !== 'string' ||
      !value.id.startsWith('compact_') ||
      typeof value.content !== 'string'
    ) {
      return [value];
    }

    const retiredContextIndex = value.content.indexOf(RETIRED_COMPACTION_PROFILE_CONTEXT_PREFIX);
    if (retiredContextIndex < 0) return [value];

    const retainedSummary = value.content.slice(0, retiredContextIndex).trim();
    return retainedSummary ? [{ ...value, content: retainedSummary }] : [];
  });
}

function removeRetiredCompactionProfileContext(persistedState: unknown): unknown {
  if (!isRecord(persistedState) || !Array.isArray(persistedState.conversations)) {
    return persistedState;
  }

  return {
    ...persistedState,
    conversations: persistedState.conversations.map((value) => {
      if (!isRecord(value)) return value;
      return {
        ...value,
        messages: removeRetiredCompactionProfileContextFromMessages(value.messages),
      };
    }),
  };
}

export function migrateRetiredChatMemory(
  persistedState: unknown,
  persistedVersion: number,
): Partial<ChatState> | undefined {
  const migrationInput =
    !Number.isSafeInteger(persistedVersion) ||
    persistedVersion < RETIRED_COMPACTION_PROFILE_CONTEXT_MIGRATION_VERSION
      ? removeRetiredCompactionProfileContext(persistedState)
      : persistedState;
  return migrationInput as Partial<ChatState> | undefined;
}
