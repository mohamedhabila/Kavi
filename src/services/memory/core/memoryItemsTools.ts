// ---------------------------------------------------------------------------
// Kavi — Memory tools: remember, search, forget
// ---------------------------------------------------------------------------
// Three flat tools over memory items, the interface LangMem (manage_memory/search_memory),
// mem0 (add/search/delete) and the ChatGPT memory tool converged on. The model writes one
// self-contained statement; code supplies provenance and sensitivity.
// Nothing here rejects a write for how it was phrased: a duplicate is acknowledged, an
// unknown `replaces` id is ignored, and only credentials are refused.
// ---------------------------------------------------------------------------

import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../types/toolRuntimeOutcome';
import { truncateGraphemesWithSuffix } from '../../../utils/graphemeBoundary';
import { MEMORY_ITEM_TEXT_MAX_CHARS } from './memorySchema';
import { searchMemoryTurns, type MemoryTurn } from './memoryTurnsStore';
import {
  addMemoryItem,
  forgetMemoryItem,
  getCurrentMemoryItem,
  searchMemoryItems,
  type MemoryItem,
} from './memoryItemsStore';

export const MEMORY_SEARCH_DEFAULT_LIMIT = 8;
export const MEMORY_SEARCH_MAX_LIMIT = 20;
const MEMORY_SEARCH_TURN_LIMIT = 5;
const MEMORY_SEARCH_TURN_MAX_CHARS = 1_200;

export interface MemoryToolContext {
  /** The conversation being answered; recorded as a saved memory's source. */
  conversationId: string;
  /** The user message being answered; recorded as the memory's source. */
  sourceMessageId: string | null;
  /** User messages the request already carries: a search does not return their rounds. */
  inRequestUserMessageIds: ReadonlyArray<string>;
  now: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidArguments(message: string): ToolRuntimeOutcome {
  return failedToolOutcome(
    JSON.stringify({ ok: false, status: 'rejected', error: 'invalid_arguments', message }),
  );
}

function optionalBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'boolean' ? value : null;
}

function isoDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function presentItem(item: MemoryItem): Record<string, unknown> {
  return {
    id: item.id,
    text: item.text,
    date: isoDate(item.updatedAt),
    ...(item.pinned ? { pinned: true } : {}),
    ...(item.sensitive ? { sensitive: true } : {}),
  };
}

function presentTurn(turn: MemoryTurn): Record<string, unknown> {
  return {
    date: isoDate(turn.at),
    text: truncateGraphemesWithSuffix(turn.text, MEMORY_SEARCH_TURN_MAX_CHARS, '…'),
  };
}

export function executeMemoryRemember(
  args: unknown,
  context: MemoryToolContext,
): ToolRuntimeOutcome {
  if (!isRecord(args)) return invalidArguments('Pass an object with a content string.');
  const content = typeof args.content === 'string' ? args.content : '';
  const pinned = optionalBoolean(args.pinned);
  const sensitive = optionalBoolean(args.sensitive);
  if (pinned === null || sensitive === null) {
    return invalidArguments('pinned and sensitive must be true or false.');
  }
  const replaces =
    typeof args.replaces === 'string' && args.replaces.trim() ? args.replaces.trim() : null;

  const result = addMemoryItem({
    text: content,
    conversationId: context.conversationId,
    ...(pinned !== undefined ? { pinned } : {}),
    ...(sensitive !== undefined ? { sensitive } : {}),
    sourceMessageId: context.sourceMessageId,
    replaces,
    now: context.now,
  });
  switch (result.status) {
    case 'created':
      return completedToolOutcome(
        JSON.stringify({
          ok: true,
          status: 'saved',
          memory: presentItem(result.item),
          ...(result.replacedId ? { replaced: result.replacedId } : {}),
        }),
      );
    case 'duplicate':
      return completedToolOutcome(
        JSON.stringify({ ok: true, status: 'already_saved', memory: presentItem(result.item) }),
      );
    case 'restricted':
      return failedToolOutcome(
        JSON.stringify({
          ok: false,
          status: 'rejected',
          error: 'restricted',
          message: 'Credentials such as passwords, API keys and access tokens are never stored.',
        }),
      );
    case 'invalid':
      return invalidArguments(
        result.reason === 'empty'
          ? 'content must be a non-empty statement.'
          : `content must be at most ${MEMORY_ITEM_TEXT_MAX_CHARS} characters.`,
      );
  }
}

export function executeMemorySearch(args: unknown, context: MemoryToolContext): ToolRuntimeOutcome {
  if (!isRecord(args) || typeof args.query !== 'string' || !args.query.trim()) {
    return invalidArguments('Pass an object with a non-empty query string.');
  }
  const requestedLimit = args.limit;
  if (
    requestedLimit !== undefined &&
    (typeof requestedLimit !== 'number' || !Number.isInteger(requestedLimit) || requestedLimit < 1)
  ) {
    return invalidArguments(`limit must be a whole number from 1 to ${MEMORY_SEARCH_MAX_LIMIT}.`);
  }
  const limit = Math.min(requestedLimit ?? MEMORY_SEARCH_DEFAULT_LIMIT, MEMORY_SEARCH_MAX_LIMIT);
  // An explicit search is the one place sensitive memories and past rounds are returned.
  const memories = searchMemoryItems({
    query: args.query,
    limit,
    includeSensitive: true,
  });
  const earlierConversations = searchMemoryTurns({
    query: args.query,
    limit: MEMORY_SEARCH_TURN_LIMIT,
    includeSensitive: true,
    excludeUserMessageIds: context.inRequestUserMessageIds,
  });
  return completedToolOutcome(
    JSON.stringify({
      ok: true,
      memories: memories.map(presentItem),
      earlierConversations: earlierConversations.map(presentTurn),
    }),
  );
}

export function executeMemoryForget(args: unknown): ToolRuntimeOutcome {
  if (!isRecord(args) || typeof args.id !== 'string' || !args.id.trim()) {
    return invalidArguments('Pass an object with the id of the memory to forget.');
  }
  const id = args.id.trim();
  // An id that is already gone, or was superseded by a correction, leaves nothing to delete.
  const forgotten = getCurrentMemoryItem(id) !== null && forgetMemoryItem(id);
  return completedToolOutcome(
    JSON.stringify({ ok: true, status: forgotten ? 'forgotten' : 'not_found', id }),
  );
}
