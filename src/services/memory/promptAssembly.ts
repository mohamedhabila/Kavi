// ---------------------------------------------------------------------------
// Kavi — Prompt assembly (4-layer + cache breakpoint)
// ---------------------------------------------------------------------------
// Produces the `SystemPromptSection[]` array consumed by LlmService. The
// assembler is intentionally pure — it does not touch the network and does
// not read from any global state. All inputs are passed in explicitly so the
// orchestrator stays in charge of fact retrieval, focus rendering, etc.
//
// Layer layout (see _research/SINGLE_THREAD_MEMORY_REDESIGN_20260429.md §6):
//
//   L1  Stable system prompt    — base instructions, tool style guidance.
//   L2  Persistent memory       — pinned blocks (profile / persona / prefs)
//                                 followed by entity dossier (canonicalized).
//   ────── cache breakpoint ──────  (last cacheable section gets cache_control)
//   L3  Per-turn context        — focus block + retrieved facts + open threads.
//   L4  User turn               — handled by caller as a message, NOT a section.
//
// The user-turn layer (L4) is intentionally NOT emitted by this module — it
// is sent as a real `user` message in the request payload, not as system
// content. Attachments belong to L4 as well (kept out of cached sections to
// avoid invalidating provider caches on image-bearing turns).
// ---------------------------------------------------------------------------

import type { MemoryBlock } from './blocks';
import type { MemoryFact } from './facts';

export interface SystemPromptSection {
  text: string;
  /** When true, the section is part of the cacheable prefix (L1 + L2). */
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
   * caller picks which entities are worth pinning to the cacheable prefix
   * (e.g. the user, the active project). Order must be deterministic.
   */
  entityDossier?: string;
  /**
   * L3 — focus block. Already-rendered string from `renderFocusBlock`.
   * Empty string means no per-turn focus is needed.
   */
  focusBlock?: string;
  /**
   * L3 — facts retrieved for THIS turn. Caller is responsible for ranking
   * and capping. Listed in caller-provided order.
   */
  retrievedFacts?: MemoryFact[];
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
const L3_FACTS_HEADER = '### Retrieved Memory';

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

function renderFact(fact: MemoryFact): string {
  // Compact one-liner. Confidence rendered only when meaningfully low.
  const conf =
    typeof fact.confidence === 'number' && fact.confidence < 0.6
      ? ` (confidence ${fact.confidence.toFixed(2)})`
      : '';
  return `- ${fact.subjectId} ${fact.predicate}: ${fact.objectText}${conf}`;
}

function renderL3(input: AssemblePromptInput): string {
  const focus = (input.focusBlock ?? '').trim();
  const facts = (input.retrievedFacts ?? []).map(renderFact);
  const addenda = joinNonEmpty(input.dynamicAddenda ?? []);

  const parts: string[] = [];
  if (focus) parts.push(focus);
  if (facts.length > 0) parts.push(`${L3_FACTS_HEADER}\n${facts.join('\n')}`);
  if (addenda) parts.push(addenda);

  if (parts.length === 0) return '';
  return `${L3_HEADER}\n${parts.join('\n\n')}`;
}

export interface AssemblePromptOutput {
  sections: SystemPromptSection[];
  /** Stable hash of the cacheable prefix — useful as `prompt_cache_key` for OpenAI. */
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
 * The returned array can be handed straight to LlmService — sections marked
 * `cacheable: true` form the stable prefix (L1+L2); sections without
 * `cacheable` are dynamic per turn (L3). LlmService applies the provider's
 * cache marker (Anthropic `cache_control`, OpenAI `prompt_cache_key`,
 * Gemini `cachedContent`) at the LAST cacheable section.
 */
export function assemblePrompt(input: AssemblePromptInput): AssemblePromptOutput {
  const l1 = renderL1(input);
  const l2 = renderL2(input);
  const l3 = renderL3(input);

  const sections: SystemPromptSection[] = [];
  if (l1) sections.push({ text: l1, cacheable: true });
  if (l2) sections.push({ text: l2, cacheable: true });
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
