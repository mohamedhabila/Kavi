// ---------------------------------------------------------------------------
// Kavi — Memory in the system prompt
// ---------------------------------------------------------------------------
// Built on every request with no model call:
// - Memory: pinned memories plus the memories that best match the latest user message
//   (BM25 over the trigram index). Each line carries its date, because memories can be
//   outdated, and its id, so the model can correct one (memory_remember with `replaces`) or
//   delete it (memory_forget). Sensitive memories are left out; the model reaches them with
//   memory_search when the user asks.
// - Earlier conversations: the past rounds from other conversations that best match the
//   request, dated, so "what did we plan last week" works without any extraction. Sensitive
//   past turns are left out the same way.
// ---------------------------------------------------------------------------

import { truncateGraphemesWithSuffix } from '../../../utils/graphemeBoundary';
import { searchMemoryTurns, type MemoryTurn } from './memoryTurnsStore';
import {
  listPinnedMemoryItems,
  searchMemoryItems,
  type MemoryItem,
  type MemoryItemVisibility,
} from './memoryItemsStore';

export const MEMORY_PROMPT_PINNED_LIMIT = 20;
export const MEMORY_PROMPT_RELEVANT_LIMIT = 6;
export const MEMORY_PROMPT_TURN_LIMIT = 3;
const MEMORY_PROMPT_TURN_MAX_CHARS = 800;
/** About 2.5k tokens: past that, small readers lose accuracy (LongMemEval, Llama-3.1-8B). */
export const MEMORY_PROMPT_MAX_CHARS = 10_000;

const MEMORY_SECTION_HEADER = `## Memory
What the user asked you to remember and what you learned in earlier conversations. Use it when it helps; it may be outdated. When the user corrects something here, save the correction with memory_remember and pass the old memory's id as replaces.`;

const TURNS_SECTION_HEADER = `## Earlier conversations
Past exchanges that may relate to this request.`;

function isoDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function renderItem(item: MemoryItem): string {
  return `- (${isoDate(item.updatedAt)}) ${item.text} [id: ${item.id}]`;
}

function renderTurn(turn: MemoryTurn): string {
  return `- (${isoDate(turn.at)}) ${truncateGraphemesWithSuffix(turn.text, MEMORY_PROMPT_TURN_MAX_CHARS, '…')}`;
}

export interface MemoryPromptSection {
  text: string;
  itemIds: string[];
}

/** The memory section for a request, or null when nothing applies. */
export function buildMemoryPromptSection(params: {
  visibility: MemoryItemVisibility;
  latestUserMessage: string;
}): MemoryPromptSection | null {
  const pinned = listPinnedMemoryItems({
    visibility: params.visibility,
    limit: MEMORY_PROMPT_PINNED_LIMIT,
    includeSensitive: false,
  });
  const pinnedIds = new Set(pinned.map((item) => item.id));
  const relevant = searchMemoryItems({
    query: params.latestUserMessage,
    visibility: params.visibility,
    limit: MEMORY_PROMPT_RELEVANT_LIMIT + pinned.length,
    includeSensitive: false,
  })
    .filter((item) => !pinnedIds.has(item.id))
    .slice(0, MEMORY_PROMPT_RELEVANT_LIMIT);

  const itemLines: string[] = [];
  const itemIds: string[] = [];
  let size = MEMORY_SECTION_HEADER.length + TURNS_SECTION_HEADER.length;
  for (const item of [...pinned, ...relevant]) {
    const line = renderItem(item);
    if (size + line.length + 1 > MEMORY_PROMPT_MAX_CHARS) break;
    itemLines.push(line);
    itemIds.push(item.id);
    size += line.length + 1;
  }
  const turnLines: string[] = [];
  for (const turn of searchMemoryTurns({
    query: params.latestUserMessage,
    limit: MEMORY_PROMPT_TURN_LIMIT,
    includeSensitive: false,
    excludeConversationId: params.visibility.conversationId,
  })) {
    const line = renderTurn(turn);
    if (size + line.length + 1 > MEMORY_PROMPT_MAX_CHARS) break;
    turnLines.push(line);
    size += line.length + 1;
  }
  const sections = [
    itemLines.length ? `${MEMORY_SECTION_HEADER}\n${itemLines.join('\n')}` : '',
    turnLines.length ? `${TURNS_SECTION_HEADER}\n${turnLines.join('\n')}` : '',
  ].filter(Boolean);
  if (sections.length === 0) return null;
  return { text: sections.join('\n\n'), itemIds };
}
