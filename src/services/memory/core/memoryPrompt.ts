// ---------------------------------------------------------------------------
// Kavi — Memory in the system prompt
// ---------------------------------------------------------------------------
// Built on every request with no model call:
// - Memory: pinned memories plus the memories that best match the latest user message
//   (BM25 over the trigram index). Each line carries its date, because memories can be
//   outdated, and its id, so the model can correct one (memory_remember with `replaces`) or
//   delete it (memory_forget). Sensitive memories are left out; the model reaches them with
//   memory_search when the user asks.
// - Earlier exchanges: the past rounds that best match the request and are not among its
//   messages, dated, so "what did we plan last week" works without any extraction. They come
//   from other conversations and from earlier in this one, once its rounds have left the
//   messages the request carries (Kavi is one long conversation). Sensitive past turns are
//   left out the same way.
// ---------------------------------------------------------------------------

import { truncateGraphemesWithSuffix } from '../../../utils/graphemeBoundary';
import { recordMemoryPromptBuild } from './memoryPromptLog';
import { searchMemoryTurns, type MemoryTurn } from './memoryTurnsStore';
import { listPinnedMemoryItems, searchMemoryItems, type MemoryItem } from './memoryItemsStore';

export const MEMORY_PROMPT_PINNED_LIMIT = 20;
export const MEMORY_PROMPT_RELEVANT_LIMIT = 6;
export const MEMORY_PROMPT_TURN_LIMIT = 3;
const MEMORY_PROMPT_TURN_MAX_CHARS = 800;
/** About 2.5k tokens: past that, small readers lose accuracy (LongMemEval, Llama-3.1-8B). */
export const MEMORY_PROMPT_MAX_CHARS = 10_000;

const MEMORY_SECTION_HEADER = `## Memory
What the user asked you to remember and what you learned in earlier conversations. Use it when it helps; it may be outdated. When the user corrects something here, save the correction with memory_remember and pass the old memory's id as replaces.`;

const TURNS_SECTION_HEADER = `## Earlier exchanges
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
  /** Past turns shown, by the id of the user message that opened each. */
  turnIds: string[];
}

interface MemoryPromptRequest {
  conversationId: string;
  latestUserMessage: string;
  /** User messages the request already carries: the rounds they opened are not recalled. */
  inRequestUserMessageIds: ReadonlyArray<string>;
}

/** The memory section for a request, or null when nothing applies. */
export function buildMemoryPromptSection(params: MemoryPromptRequest): MemoryPromptSection | null {
  const pinned = listPinnedMemoryItems({
    limit: MEMORY_PROMPT_PINNED_LIMIT,
    includeSensitive: false,
  });
  const pinnedIds = new Set(pinned.map((item) => item.id));
  const relevant = searchMemoryItems({
    query: params.latestUserMessage,
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
  const turnIds: string[] = [];
  for (const turn of searchMemoryTurns({
    query: params.latestUserMessage,
    limit: MEMORY_PROMPT_TURN_LIMIT,
    includeSensitive: false,
    excludeUserMessageIds: params.inRequestUserMessageIds,
  })) {
    const line = renderTurn(turn);
    if (size + line.length + 1 > MEMORY_PROMPT_MAX_CHARS) break;
    turnLines.push(line);
    turnIds.push(turn.userMessageId);
    size += line.length + 1;
  }
  const sections = [
    itemLines.length ? `${MEMORY_SECTION_HEADER}\n${itemLines.join('\n')}` : '',
    turnLines.length ? `${TURNS_SECTION_HEADER}\n${turnLines.join('\n')}` : '',
  ].filter(Boolean);
  if (sections.length === 0) return null;
  return { text: sections.join('\n\n'), itemIds, turnIds };
}

/** Builds the section for a request and records what it held and how long it took. */
export function prepareMemoryPromptSection(
  params: MemoryPromptRequest,
): MemoryPromptSection | null {
  const startedAt = Date.now();
  const section = buildMemoryPromptSection(params);
  recordMemoryPromptBuild({
    conversationId: params.conversationId,
    at: startedAt,
    itemIds: section?.itemIds ?? [],
    turnIds: section?.turnIds ?? [],
    chars: section?.text.length ?? 0,
    durationMs: Date.now() - startedAt,
  });
  return section;
}
