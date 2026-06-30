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
import { compactUiInventoryPromptFields } from './promptUiInventoryFields';
import { isUiSurfaceMemoryKind, promptFieldsForMemoryKind } from './uiFactFields';
import {
  collectUiObservationEvidenceTexts,
  hasStructuredUiObservation,
} from './uiObservationEvidence';

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
  'UI inventories are observed evidence for a specific URL/state. Listed controls, fields, field displayText, field symbolMarkers, sections, table interactiveControls, and paths were visible; if the identified surface lacks a requested control, answer that no such control/options are present, not unknown. landmarkRows summarize section labels, controls, and text by accessibility landmark. sectionRows group controls and text by observed region; use landmarkRole and structuralPath as layout evidence when a question refers to page region or position. landmarkRole follows accessibility landmarks: main is primary content; complementary is supporting secondary content. queryQuotedControlLabelEvidence is exact quoted control-label evidence; unmatched quoted spans may be values, IDs, names, or content. Table columnLabels name columns; table interactiveControls are the observed controls inside that table. rowCount is the observed table cardinality for that snapshot; do not infer extra directly visible rows beyond rowCount. Treat rowSample values as content, not controls, unless found in interactiveControls or another control field. Use exact labels/values without renaming them or inferring absent statuses. Table schema, dates, and counters are not members of an ordered row-value sequence unless inside that row. Count ordinals only within the requested role/context. Past-end ordered options are absent.';
const L3_PROCEDURES_HEADER = '#### Procedures';
const L3_PROCEDURES_NOTE =
  'Procedure traces are observed action-history evidence. Treat successful traces as stronger action guidance; treat failed traces as evidence for actions that did not complete the goal. Do not infer unobserved screens, controls, or workflow steps from platform conventions; when the trace shows fewer relevant visible phases than a requested ordinal, treat the missing ordinal as observed absence.';
const L3_OUTCOMES_HEADER = '#### Outcomes and Gotchas';
const L3_OUTCOMES_NOTE =
  'Action-result memories may include recentActionTrail, stateTransition, immediatePriorObservation, and resultingObservation. recentActionTrail is bounded same-source history before the resulting state; stateTransition is the observed next action from a prior state into the resulting state. Use them as direct action memory when the current user is at a matching screen/state.';
const L3_EPISODES_HEADER = '### Recent Activity';
const MAX_RENDERED_FACT_CHARS = 3_200;
const MAX_RENDERED_PROCEDURE_FACT_CHARS = 5_000;
const MAX_RENDERED_UI_FACT_CHARS = 2_400;
const MAX_RETRIEVED_FACT_SECTION_CHARS = 3_400;
const MAX_RENDERED_EPISODE_CHARS = 200;
const MAX_PROCEDURE_STEP_TEXT_CHARS = 140;
const MAX_PROCEDURE_SURFACE_TRAIL_ENTRIES = 16;

function hasPromptUiObservation(
  fact: PromptMemoryFact,
  parsed: Record<string, unknown> | null,
): boolean {
  return fact.memoryKind === 'outcome' && hasStructuredUiObservation(parsed, fact.attributes);
}

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

function dropEmptyPromptRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null || entry === '') return false;
      return !Array.isArray(entry) || entry.length > 0;
    }),
  );
}

function compactProcedureStep(step: unknown): Record<string, unknown> | null {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
  const input = step as Record<string, unknown>;
  const compact: Record<string, unknown> = {};
  const copyScalar = (field: string): void => {
    const value = input[field];
    if (value === undefined || value === null || value === '') return;
    compact[field] =
      typeof value === 'string' ? fitText(value, MAX_PROCEDURE_STEP_TEXT_CHARS) : value;
  };
  copyScalar('stateIndex');
  copyScalar('state_index');
  copyScalar('url');
  copyScalar('action');
  copyScalar('thought');
  copyScalar('outcome');
  return Object.keys(compact).length > 0 ? compact : null;
}

function compactProcedureSurfaceTrailStep(step: unknown): Record<string, unknown> | null {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
  const input = step as Record<string, unknown>;
  const stateIndex = input.stateIndex ?? input.state_index;
  const url = input.url;
  const action = input.action;
  const compact = dropEmptyPromptRecord({
    stateIndex:
      typeof stateIndex === 'string'
        ? fitText(stateIndex, 24)
        : typeof stateIndex === 'number'
          ? stateIndex
          : undefined,
    url: typeof url === 'string' ? fitText(url, 220) : undefined,
    action: typeof action === 'string' ? fitText(action, 120) : undefined,
  });
  return Object.keys(compact).length > 0 ? compact : null;
}

function sameProcedureSurfaceTrailEntry(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): boolean {
  if (!left || !right) return false;
  return (
    left.stateIndex === right.stateIndex && left.url === right.url && left.action === right.action
  );
}

function capProcedureSurfaceTrail(trail: Record<string, unknown>[]): Record<string, unknown>[] {
  if (trail.length <= MAX_PROCEDURE_SURFACE_TRAIL_ENTRIES) return trail;
  const headCount = Math.ceil(MAX_PROCEDURE_SURFACE_TRAIL_ENTRIES / 2);
  const tailCount = Math.floor(MAX_PROCEDURE_SURFACE_TRAIL_ENTRIES / 2);
  const capped: Record<string, unknown>[] = [];
  for (const entry of [...trail.slice(0, headCount), ...trail.slice(-tailCount)]) {
    if (sameProcedureSurfaceTrailEntry(capped[capped.length - 1] ?? null, entry)) continue;
    capped.push(entry);
  }
  return capped;
}

function compactProcedureSurfaceTrail(steps: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(steps)) return null;
  const trail: Record<string, unknown>[] = [];
  let lastUrl: string | null = null;
  let finalEntry: Record<string, unknown> | null = null;
  for (const step of steps) {
    const entry = compactProcedureSurfaceTrailStep(step);
    if (!entry) continue;
    finalEntry = entry;
    const url = typeof entry.url === 'string' ? entry.url : null;
    if (trail.length === 0 || (url && url !== lastUrl)) {
      if (!sameProcedureSurfaceTrailEntry(trail[trail.length - 1] ?? null, entry)) {
        trail.push(entry);
      }
    }
    if (url) lastUrl = url;
  }
  if (finalEntry && !sameProcedureSurfaceTrailEntry(trail[trail.length - 1] ?? null, finalEntry)) {
    trail.push(finalEntry);
  }
  return trail.length > 0 ? capProcedureSurfaceTrail(trail) : null;
}

function compactProcedurePromptFields(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;
  const compact: Record<string, unknown> = {};
  const copyField = (field: string): void => {
    const value = parsed[field];
    if (value !== undefined && value !== null && value !== '') compact[field] = value;
  };
  copyField('sourceRunId');
  copyField('goal');
  copyField('trajectoryOutcome');
  copyField('domain');
  copyField('environment');
  copyField('stepCount');
  const surfaceTrail = compactProcedureSurfaceTrail(parsed.steps);
  if (surfaceTrail) compact.surfaceTrail = surfaceTrail;
  if (Array.isArray(parsed.steps)) {
    const steps = parsed.steps.map(compactProcedureStep).filter(Boolean);
    if (steps.length > 0) compact.steps = steps;
  }
  return Object.keys(compact).length > 0 ? JSON.stringify(compact) : null;
}

function compactActionResultPromptFields(
  fact: PromptMemoryFact,
  parsed: Record<string, unknown> | null,
): string | null {
  if (!parsed) return null;
  const root: Record<string, unknown> = {};
  let stateTransition: Record<string, unknown> = {};
  const immediatePriorObservation: Record<string, unknown> = {};
  const resultingObservation: Record<string, unknown> = {};
  const readField = (field: string): unknown =>
    field === 'sourceRunId'
      ? (fact.sourceRunId ?? fact.attributes[field] ?? parsed[field])
      : (fact.attributes[field] ?? parsed[field]);
  const copyField = (target: Record<string, unknown>, field: string): void => {
    const rawValue =
      field === 'sourceRunId'
        ? (fact.sourceRunId ?? fact.attributes[field] ?? parsed[field])
        : (fact.attributes[field] ?? parsed[field]);
    if (rawValue === undefined || rawValue === null || rawValue === '') return;
    target[field] = typeof rawValue === 'string' ? fitText(rawValue, 700) : rawValue;
  };

  copyField(root, 'sourceRunId');
  copyField(root, 'url');
  const recentActionTrail = compactActionTrailForPrompt(parsed.recentActionTrail);
  const previousAction = readField('previousAction');
  const previousThought = readField('previousThought');
  const previousStateIndex = readField('previousStateIndex');
  if (previousAction !== undefined && previousAction !== null && previousAction !== '') {
    immediatePriorObservation.action =
      typeof previousAction === 'string' ? fitText(previousAction, 700) : previousAction;
  }
  if (previousThought !== undefined && previousThought !== null && previousThought !== '') {
    immediatePriorObservation.thought =
      typeof previousThought === 'string' ? fitText(previousThought, 700) : previousThought;
  }
  if (
    previousStateIndex !== undefined &&
    previousStateIndex !== null &&
    previousStateIndex !== ''
  ) {
    immediatePriorObservation.stateIndex = previousStateIndex;
  }

  copyField(resultingObservation, 'action');
  copyField(resultingObservation, 'thought');
  copyField(resultingObservation, 'outcome');
  copyField(resultingObservation, 'stateIndex');
  if (Object.keys(immediatePriorObservation).length > 0) {
    stateTransition = dropEmptyPromptRecord({
      fromStateIndex: immediatePriorObservation.stateIndex,
      nextObservedAction: resultingObservation.action,
      toStateIndex: resultingObservation.stateIndex,
      priorStateRationale: immediatePriorObservation.thought,
    });
  }

  const compact = {
    ...root,
    ...dropEmptyPromptRecord({
      stateTransition: Object.keys(stateTransition).length > 0 ? stateTransition : undefined,
      immediatePriorObservation:
        Object.keys(immediatePriorObservation).length > 0 ? immediatePriorObservation : undefined,
      resultingObservation:
        Object.keys(resultingObservation).length > 0 ? resultingObservation : undefined,
      recentActionTrail,
    }),
  };

  const primaryTexts = new Set(
    [
      immediatePriorObservation.action,
      immediatePriorObservation.thought,
      resultingObservation.action,
      resultingObservation.thought,
      resultingObservation.outcome,
    ]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLocaleLowerCase()),
  );
  const uiEvidence = collectUiObservationEvidenceTexts(parsed, fact.attributes)
    .filter((text) => !primaryTexts.has(text.toLocaleLowerCase()))
    .slice(0, 12)
    .map((text) => fitText(text, 160));
  if (uiEvidence.length > 0) compact.uiEvidence = uiEvidence;
  return Object.keys(compact).length > 0 ? JSON.stringify(compact) : null;
}

function compactActionTrailForPrompt(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .slice(-8)
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const input = entry as Record<string, unknown>;
      return dropEmptyPromptRecord({
        stateIndex: input.stateIndex,
        action:
          typeof input.action === 'string'
            ? fitBalancedPromptText(input.action, 240)
            : input.action,
        thought:
          typeof input.thought === 'string'
            ? fitBalancedPromptText(input.thought, 240)
            : input.thought,
      });
    })
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && Object.keys(entry).length > 0),
    );
  return entries.length > 0 ? entries : undefined;
}

function fitBalancedPromptText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed || maxChars <= 0) return '';
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 8) return fitText(trimmed, maxChars);
  const headChars = Math.ceil((maxChars - 1) * 0.55);
  const tailChars = Math.floor((maxChars - 1) * 0.45);
  return `${trimmed.slice(0, headChars).trimEnd()}\u2026${trimmed.slice(-tailChars).trimStart()}`;
}

function renderableFactText(fact: PromptMemoryFact): string {
  const memoryKind = fact.memoryKind ?? 'semantic_fact';
  const fields = promptFieldsForMemoryKind(memoryKind);
  if (memoryKind === 'procedure') {
    const rendered = compactProcedurePromptFields(parseJsonRecord(fact.objectText));
    if (rendered) return rendered;
  }
  const parsed = parseJsonRecord(fact.objectText);
  if (memoryKind === 'outcome' && hasPromptUiObservation(fact, parsed)) {
    const rendered = compactActionResultPromptFields(fact, parsed);
    if (rendered) return rendered;
  }
  if (hasPromptUiObservation(fact, parsed)) {
    const rendered = compactUiInventoryPromptFields(fact, parsed);
    if (rendered) return rendered;
  }
  if (!fields) return fact.objectText;
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
      : isUiSurfaceMemoryKind(memoryKind) ||
          hasPromptUiObservation(fact, parseJsonRecord(fact.objectText))
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
  if (memoryKind === 'outcome' || memoryKind === 'gotcha') return L3_OUTCOMES_HEADER;
  if (
    isUiSurfaceMemoryKind(memoryKind) ||
    hasPromptUiObservation(fact, parseJsonRecord(fact.objectText))
  ) {
    return L3_UI_HEADER;
  }
  if (memoryKind === 'procedure') return L3_PROCEDURES_HEADER;
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
  const noteLines =
    group.header === L3_UI_HEADER
      ? [L3_UI_SNAPSHOT_NOTE]
      : group.header === L3_PROCEDURES_HEADER
        ? [L3_PROCEDURES_NOTE]
        : group.header === L3_OUTCOMES_HEADER
          ? [L3_OUTCOMES_NOTE]
          : [];
  let lines: string[] = [...noteLines];
  let sectionChars =
    sectionPrefix.length + noteLines.reduce((sum, line) => sum + 1 + line.length, 0);
  let hasFactInSection = false;

  for (const fact of group.facts) {
    const line = renderFact(fact);
    const nextChars = sectionChars + 1 + line.length;
    if (hasFactInSection && nextChars > MAX_RETRIEVED_FACT_SECTION_CHARS) {
      sections.push(`${sectionPrefix}\n${lines.join('\n')}`);
      lines = [];
      sectionChars = sectionPrefix.length;
      hasFactInSection = false;
    }
    lines.push(line);
    sectionChars += 1 + line.length;
    hasFactInSection = true;
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
