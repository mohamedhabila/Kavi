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
import { compactJsonFields, parseJsonRecord } from './factJson';
import { isUiSurfaceMemoryKind, promptFieldsForMemoryKind } from './uiFactFields';

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
const L3_RELEVANT_FACTS_HEADER = '#### Relevant Facts';
const L3_UI_HEADER = '#### Observed UI and Surface Schema';
const L3_UI_SNAPSHOT_NOTE =
  'UI inventories are direct evidence for UI availability in observed states. Listed controls and fields were visible for that URL/state; controls not listed were not visible in that snapshot. Treat a named control missing from a snapshot visibleControls list as observed negative visibility evidence for that snapshot, not as unknown. Ordered options arrays preserve the observed option order; when a requested neighbor would fall past the last listed option, that is observed absence, not unknown.';
const L3_PROCEDURES_HEADER = '#### Procedures';
const L3_OUTCOMES_HEADER = '#### Outcomes and Gotchas';
const L3_EPISODES_HEADER = '### Recent Activity';
const MAX_RENDERED_FACT_CHARS = 3_200;
const MAX_RENDERED_PROCEDURE_FACT_CHARS = 5_000;
const MAX_RENDERED_UI_FACT_CHARS = 2_400;
const MAX_RETRIEVED_FACT_SECTION_CHARS = 3_400;
const MAX_RENDERED_EPISODE_CHARS = 200;

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

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

function compactFactFields(
  fact: PromptMemoryFact,
  parsed: Record<string, unknown> | null,
  fields: ReadonlyArray<string>,
): string | null {
  const compact: Record<string, unknown> = {};
  let hasEvidenceField = false;
  for (const field of fields) {
    const rawValue =
      field === 'sourceRunId'
        ? (fact.sourceRunId ?? fact.attributes[field] ?? parsed?.[field])
        : (fact.attributes[field] ?? parsed?.[field]);
    if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
      compact[field] = rawValue;
      if (field !== 'sourceRunId' && field !== 'stateIndex') hasEvidenceField = true;
    }
  }
  return hasEvidenceField ? JSON.stringify(compact) : null;
}

function compactUiInventoryPromptFields(
  fact: PromptMemoryFact,
  parsed: Record<string, unknown> | null,
): string | null {
  if (!parsed) return null;
  const compact: Record<string, unknown> = {};
  const copyField = (from: string, to = from): void => {
    const rawValue =
      from === 'sourceRunId'
        ? (fact.sourceRunId ?? fact.attributes[from] ?? parsed[from])
        : (fact.attributes[from] ?? parsed[from]);
    if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
      compact[to] = rawValue;
    }
  };

  copyField('goal', 'sourceGoal');
  copyField('trajectoryOutcome');
  copyField('domain');
  copyField('environment');
  copyField('url');
  copyField('sourceRunId');
  copyField('stateIndex');
  copyField('tables');
  copyField('labelValues');
  copyField('fieldLabels');
  copyField('fields');
  copyField('textEntryControls');
  copyField('searchControls');
  copyField('popupControls');
  copyField('controlNames', 'visibleControls');
  if (!compact.visibleControls && Array.isArray(parsed.controls)) {
    const visibleControls = parsed.controls
      .map((control) =>
        control && typeof control === 'object' && !Array.isArray(control)
          ? (control as Record<string, unknown>).name
          : null,
      )
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
    if (visibleControls.length > 0) compact.visibleControls = visibleControls.slice(0, 48);
  }
  copyField('sections');
  copyField('nodeCount');
  copyField('controlCount');
  copyField('textEntryCount');
  copyField('searchControlCount');
  return Object.keys(compact).length > 0 ? JSON.stringify(compact) : null;
}

function renderableFactText(fact: PromptMemoryFact): string {
  const memoryKind = fact.memoryKind ?? 'semantic_fact';
  const fields = promptFieldsForMemoryKind(memoryKind);
  if (!fields) return fact.objectText;
  const parsed = parseJsonRecord(fact.objectText);
  if (memoryKind === 'ui_inventory') {
    const rendered = compactUiInventoryPromptFields(fact, parsed);
    if (rendered) return rendered;
  }
  const compactFromAttributes = compactFactFields(fact, parsed, fields);
  if (compactFromAttributes) return compactFromAttributes;
  if (!parsed) return fact.objectText;
  return compactJsonFields(parsed, fields);
}

function renderFact(fact: PromptMemoryFact): string {
  // Compact one-liner. Confidence rendered only when meaningfully low.
  const conf =
    typeof fact.confidence === 'number' && fact.confidence < 0.6
      ? ` (confidence ${fact.confidence.toFixed(2)})`
      : '';
  const subject = fact.subjectLabel?.trim() || fact.subjectId;
  const source = fact.sourceRunId ? ` source=${fact.sourceRunId}` : '';
  const memoryKind = fact.memoryKind ?? 'semantic_fact';
  const kind = memoryKind === 'semantic_fact' ? '' : ` kind=${memoryKind}`;
  const meta = kind || source ? ` [${`${kind}${source}`.trim()}]` : '';
  const maxChars =
    memoryKind === 'procedure'
      ? MAX_RENDERED_PROCEDURE_FACT_CHARS
      : isUiSurfaceMemoryKind(memoryKind)
        ? MAX_RENDERED_UI_FACT_CHARS
        : MAX_RENDERED_FACT_CHARS;
  return `- ${subject} ${fact.predicate}: ${fitText(renderableFactText(fact), maxChars)}${conf}${meta}`;
}

function renderEpisode(episode: MemoryEpisode): string {
  const summary = episode.summary.trim();
  if (!summary) return '';
  const tools = episode.toolNames.length > 0 ? ` [${episode.toolNames.join(', ')}]` : '';
  return `- ${fitText(summary, MAX_RENDERED_EPISODE_CHARS)}${tools}`;
}

function factGroupHeader(fact: PromptMemoryFact): string {
  const memoryKind = fact.memoryKind ?? 'semantic_fact';
  if (isUiSurfaceMemoryKind(memoryKind)) {
    return L3_UI_HEADER;
  }
  if (memoryKind === 'procedure') return L3_PROCEDURES_HEADER;
  if (memoryKind === 'outcome' || memoryKind === 'gotcha') return L3_OUTCOMES_HEADER;
  return L3_RELEVANT_FACTS_HEADER;
}

function groupRetrievedFacts(facts: PromptMemoryFact[]): Array<{
  header: string;
  facts: PromptMemoryFact[];
}> {
  const orderedHeaders = [
    L3_RELEVANT_FACTS_HEADER,
    L3_UI_HEADER,
    L3_PROCEDURES_HEADER,
    L3_OUTCOMES_HEADER,
  ];
  const byHeader = new Map<string, PromptMemoryFact[]>();
  for (const fact of facts) {
    const header = factGroupHeader(fact);
    const list = byHeader.get(header) ?? [];
    list.push(fact);
    byHeader.set(header, list);
  }
  return orderedHeaders
    .map((header) => ({ header, facts: byHeader.get(header) ?? [] }))
    .filter((group) => group.facts.length > 0);
}

function renderRetrievedFactGroup(group: { header: string; facts: PromptMemoryFact[] }): string[] {
  const sectionPrefix = `${L3_HEADER}\n${L3_FACTS_HEADER}\n${group.header}`;
  const sections: string[] = [];
  const baseLines = group.header === L3_UI_HEADER ? [L3_UI_SNAPSHOT_NOTE] : [];
  let lines: string[] = [...baseLines];
  let sectionChars =
    sectionPrefix.length + baseLines.reduce((sum, line) => sum + 1 + line.length, 0);

  for (const fact of group.facts) {
    const line = renderFact(fact);
    const nextChars = sectionChars + 1 + line.length;
    if (lines.length > baseLines.length && nextChars > MAX_RETRIEVED_FACT_SECTION_CHARS) {
      sections.push(`${sectionPrefix}\n${lines.join('\n')}`);
      lines = [...baseLines];
      sectionChars =
        sectionPrefix.length + baseLines.reduce((sum, baseLine) => sum + 1 + baseLine.length, 0);
    }
    lines.push(line);
    sectionChars += 1 + line.length;
  }

  if (lines.length > 0) {
    sections.push(`${sectionPrefix}\n${lines.join('\n')}`);
  }
  return sections;
}

function renderL3Sections(input: AssemblePromptInput): string[] {
  const focus = (input.focusBlock ?? '').trim();
  const reflection = (input.reflectionBlock ?? '').trim();
  const factGroups = groupRetrievedFacts(input.retrievedFacts ?? []);
  const episodes = (input.recentEpisodes ?? []).map(renderEpisode).filter((r) => r.length > 0);
  const addenda = joinNonEmpty(input.dynamicAddenda ?? []);

  const preludeParts: string[] = [];
  if (reflection) preludeParts.push(`${L3_REFLECTION_HEADER}\n${reflection}`);
  if (focus) preludeParts.push(focus);
  if (addenda) preludeParts.push(addenda);

  const trailingParts: string[] = [];
  if (episodes.length > 0) trailingParts.push(`${L3_EPISODES_HEADER}\n${episodes.join('\n')}`);

  const sections: string[] = [];
  if (preludeParts.length > 0) {
    sections.push(`${L3_HEADER}\n${preludeParts.join('\n\n')}`);
  }
  if (factGroups.length > 0) {
    sections.push(...factGroups.flatMap(renderRetrievedFactGroup));
  }
  if (trailingParts.length > 0) {
    sections.push(`${L3_HEADER}\n${trailingParts.join('\n\n')}`);
  }
  return sections;
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
  const l3Sections = renderL3Sections(input);

  const sections: SystemPromptSection[] = [];
  if (l1) sections.push({ text: l1, cacheable: true });
  if (l2) sections.push({ text: l2 });
  sections.push(...l3Sections.map((text) => ({ text })));

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
