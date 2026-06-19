// ---------------------------------------------------------------------------
// Kavi — Prompt assembly (4-layer + cache breakpoint)
// ---------------------------------------------------------------------------
// Produces the `SystemPromptSection[]` array consumed by LlmService. The
// assembler is intentionally pure — it does not touch the network and does
// not read from any global state. All inputs are passed in explicitly so the
// orchestrator stays in charge of fact retrieval, focus rendering, etc.
//
// Layer layout:
//
//   L1  Stable system prompt    — base instructions, tool style guidance.
//   ────── cache breakpoint ──────  (stable assistant/runtime policy)
//   L2  Persistent memory       — pinned blocks (profile / persona / prefs)
//                                 followed by entity dossier (canonicalized).
//   L3  Per-turn context        — focus block + retrieved facts + open threads.
//   L4  User turn               — handled by caller as a message, NOT a section.
//
// The user-turn layer (L4) is intentionally NOT emitted by this module — it
// is sent as a real `user` message in the request payload, not as system
// content. Attachments belong to L4 as well (kept out of cached sections to
// avoid invalidating provider caches on image-bearing turns).
// ---------------------------------------------------------------------------

import type { MemoryBlock } from './blocks';
import type { MemoryFact } from './facts/types';
import type { MemoryEpisode } from './episodes/types';

export type PromptMemoryFact = MemoryFact & { subjectLabel?: string };

export interface SystemPromptSection {
  text: string;
  /** When true, the section is part of the provider-cacheable prefix. */
  cacheable?: boolean;
}

export interface AssemblePromptInput {
  /** L1 — stable instructions; rendered verbatim. */
  basePrompt: string;
  /** L1 — optional fixed addenda (tool style, capability discovery, etc.). */
  baseAddenda?: string[];
  /**
   * L2 — Letta-style memory blocks. Always rendered in a stable order
   * (pinned first, then alphabetical). Empty blocks are omitted. The block
   * description is rendered as a one-liner above each block.
   */
  blocks?: MemoryBlock[];
  /**
   * L2 — optional entity dossier (canonical "who's who" snippet). The
   * caller picks which entities are worth surfacing for this request
   * (e.g. the user, the active project). Order must be deterministic.
   */
  entityDossier?: string;
  /**
   * L3 — focus block. Already-rendered string from `renderFocusBlock`.
   * Empty string means no per-turn focus is needed.
   */
  focusBlock?: string;
  /**
   * L3 — structural daily reflection summary (background-generated).
   */
  reflectionBlock?: string;
  /**
   * L3 — facts retrieved for THIS turn. Caller is responsible for ranking
   * and capping. Listed in caller-provided order.
   */
  retrievedFacts?: PromptMemoryFact[];
  /**
   * L3 — recent episodes for this thread/conversation. Listed in
   * caller-provided order (typically newest first).
   */
  recentEpisodes?: MemoryEpisode[];
  /**
   * L3 — additional dynamic context the orchestrator wants to inject
   * (e.g. workflow status, tool catalog notes that change per turn).
   */
  dynamicAddenda?: string[];
}

const L1_HEADER = '## Identity & Style';
const L2_BLOCKS_HEADER = '## Persistent Memory';
const L2_DOSSIER_HEADER = '## Known Entities';
const L3_HEADER = '## This Turn';
const L3_REFLECTION_HEADER = '### Day Focus';
const L3_FACTS_HEADER = '### Retrieved Memory';
const L3_EPISODES_HEADER = '### Recent Activity';

function joinNonEmpty(parts: Array<string | null | undefined>, sep = '\n\n'): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0)
    .join(sep);
}

function sortBlocksDeterministically(blocks: MemoryBlock[]): MemoryBlock[] {
  // Pinned first, then alphabetical by label. The same input always yields
  // the same byte sequence — critical for prompt-cache hit rates.
  return [...blocks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

function renderBlock(block: MemoryBlock): string {
  const description = block.description.trim();
  const content = block.content.trim();
  if (!content) return '';
  const head = description ? `${block.label} — ${description}` : block.label;
  return `<block label="${block.label}">\n${head}\n${content}\n</block>`;
}

function renderL1(input: AssemblePromptInput): string {
  const base = input.basePrompt.trim();
  if (!base && (!input.baseAddenda || input.baseAddenda.length === 0)) return '';
  const addenda = joinNonEmpty(input.baseAddenda ?? []);
  return joinNonEmpty([`${L1_HEADER}\n${base}`, addenda]);
}

function renderL2(input: AssemblePromptInput): string {
  const blocks = sortBlocksDeterministically(input.blocks ?? [])
    .map(renderBlock)
    .filter((rendered) => rendered.length > 0);

  const dossier = (input.entityDossier ?? '').trim();

  const sections: string[] = [];
  if (blocks.length > 0) {
    sections.push(`${L2_BLOCKS_HEADER}\n${blocks.join('\n\n')}`);
  }
  if (dossier) {
    sections.push(`${L2_DOSSIER_HEADER}\n${dossier}`);
  }
  return sections.join('\n\n');
}

function renderFact(fact: PromptMemoryFact): string {
  // Compact one-liner. Confidence rendered only when meaningfully low.
  const conf =
    typeof fact.confidence === 'number' && fact.confidence < 0.6
      ? ` (confidence ${fact.confidence.toFixed(2)})`
      : '';
  const subject = fact.subjectLabel?.trim() || fact.subjectId;
  return `- ${subject} ${fact.predicate}: ${fact.objectText}${conf}`;
}

function renderEpisode(episode: MemoryEpisode): string {
  const summary = episode.summary.trim();
  if (!summary) return '';
  const tools = episode.toolNames.length > 0 ? ` [${episode.toolNames.join(', ')}]` : '';
  return `- ${summary.slice(0, 200)}${tools}`;
}

function renderL3(input: AssemblePromptInput): string {
  const focus = (input.focusBlock ?? '').trim();
  const reflection = (input.reflectionBlock ?? '').trim();
  const facts = (input.retrievedFacts ?? []).map(renderFact);
  const episodes = (input.recentEpisodes ?? []).map(renderEpisode).filter((r) => r.length > 0);
  const addenda = joinNonEmpty(input.dynamicAddenda ?? []);

  const parts: string[] = [];
  if (reflection) parts.push(`${L3_REFLECTION_HEADER}\n${reflection}`);
  if (focus) parts.push(focus);
  if (facts.length > 0) parts.push(`${L3_FACTS_HEADER}\n${facts.join('\n')}`);
  if (episodes.length > 0) parts.push(`${L3_EPISODES_HEADER}\n${episodes.join('\n')}`);
  if (addenda) parts.push(addenda);

  if (parts.length === 0) return '';
  return `${L3_HEADER}\n${parts.join('\n\n')}`;
}

export interface AssemblePromptOutput {
  sections: SystemPromptSection[];
  /** Stable hash of the cacheable prefix. Memory sections are dynamic until admitted into an epoch. */
  cacheableSignature: string;
}

function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Assemble prompt sections in cache-friendly order.
 *
 * The returned array can be handed straight to LlmService. Only invariant
 * assistant/runtime policy belongs in the provider-cacheable prefix. Memory is
 * dynamic context until a durable context epoch admits it into a stable baseline.
 */
export function assemblePrompt(input: AssemblePromptInput): AssemblePromptOutput {
  const l1 = renderL1(input);
  const l2 = renderL2(input);
  const l3 = renderL3(input);

  const sections: SystemPromptSection[] = [];
  if (l1) sections.push({ text: l1, cacheable: true });
  if (l2) sections.push({ text: l2 });
  if (l3) sections.push({ text: l3 });

  const cacheableText = sections
    .filter((section) => section.cacheable)
    .map((section) => section.text)
    .join('\n\n');
  const cacheableSignature = fnv1aHash(cacheableText);

  return { sections, cacheableSignature };
}

/**
 * Convenience: flatten the assembled sections into a single system-prompt
 * string. Used by code paths that don't yet support per-section cache
 * markers (e.g. local on-device runtime).
 */
export function flattenPromptSections(sections: SystemPromptSection[]): string {
  return sections.map((section) => section.text).join('\n\n');
}
