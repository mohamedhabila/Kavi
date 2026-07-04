// ---------------------------------------------------------------------------
// Kavi - Prompt assembly (4-layer + cache breakpoint)
// ---------------------------------------------------------------------------
// Produces the `SystemPromptSection[]` array consumed by LlmService. The
// assembler is intentionally pure: it does not touch the network and does not
// read global memory state. Dynamic memory is grouped by agent-workflow role so
// retrieved context supports goals, tools, evidence, artifacts, decisions,
// risks, summaries, and durable facts without domain-specific prompt rules.
// ---------------------------------------------------------------------------

import type { MemoryBlock } from './blocks';
import type { MemoryFact, MemoryFactKind } from './facts/types';
import type { MemoryEpisode } from './episodes/types';
import { compactJsonFields, parseJsonRecord } from './factJson';
import { tokenizeLexicalUnits } from './ranking/lexical';
import { quotedSpanUnitSets } from './ranking/quotedSpans';

export type PromptMemoryFact = MemoryFact & { subjectLabel?: string };

export interface SystemPromptSection {
  text: string;
  /** When true, the section is part of the provider-cacheable prefix. */
  cacheable?: boolean;
}

export interface AssemblePromptInput {
  /** L1 - stable instructions; rendered verbatim. */
  basePrompt: string;
  /** L1 - optional fixed addenda (tool style, capability discovery, etc.). */
  baseAddenda?: string[];
  /**
   * L2 - Letta-style memory blocks. Always rendered in a stable order
   * (pinned first, then alphabetical). Empty blocks are omitted. The block
   * description is rendered as a one-liner above each block.
   */
  blocks?: MemoryBlock[];
  /**
   * L2 - optional entity dossier (canonical "who's who" snippet). The
   * caller picks which entities are worth surfacing for this request.
   */
  entityDossier?: string;
  /**
   * L3 - focus block. Already-rendered string from `renderFocusBlock`.
   * Empty string means no per-turn focus is needed.
   */
  focusBlock?: string;
  /** L3 - structural daily reflection summary. */
  reflectionBlock?: string;
  /** L3 - facts retrieved for this turn. Listed in caller-provided order. */
  retrievedFacts?: PromptMemoryFact[];
  /** L3 - recent episodes for this thread/conversation. */
  recentEpisodes?: MemoryEpisode[];
  /** L3 - additional dynamic context from the orchestrator. */
  dynamicAddenda?: string[];
  /**
   * Current retrieval query. Used only to render compact evidence excerpts from
   * already-selected agent-run memories; selection and persistence stay upstream.
   */
  retrievalQuery?: string;
}

const L1_HEADER = '## Identity & Style';
const L2_BLOCKS_HEADER = '## Persistent Memory';
const L2_DOSSIER_HEADER = '## Known Entities';
const L3_HEADER = '## This Turn';
const L3_REFLECTION_HEADER = '### Day Focus';
const L3_FACTS_HEADER = '### Retrieved Memory';
const L3_RELEVANT_FACTS_HEADER = '#### Relevant Facts';
const L3_PROCEDURES_HEADER = '#### Procedures';
const L3_OUTCOMES_HEADER = '#### Outcomes and Tool Results';
const L3_DECISIONS_RISKS_HEADER = '#### Decisions and Risks';
const L3_ARTIFACTS_SOURCES_HEADER = '#### Artifacts and Sources';
const L3_SUMMARIES_HEADER = '#### Summaries';
const L3_PROCEDURES_NOTE =
  'Procedure memories are complete observed workflow traces. Use the full ordered route as evidence of the workflow, including prerequisite, verification, navigation, and finalization phases; do not reduce a successful trace to only its last action. When a step records observed available actions, treat that observed action set as direct evidence of both available and unavailable actions in that state. When a step records an observed control sequence, that array preserves source order from the observed state and is direct evidence for order, adjacency, and visible controls. Grouped observed action sections are siblings, not nested groups; an action belongs only to the section object that contains it. If the request names a group, only actions inside that group satisfy it; relevant actions in sibling groups are not substitutes.';
const L3_OUTCOMES_NOTE =
  'Outcome and tool-result memories summarize completed or failed agent work. Prefer direct observed outcomes over assumptions from prior platform behavior. When an outcome records observed available actions, do not invent missing actions from nearby labels, headings, or generic platform expectations. When a step records an observed control sequence, that array preserves source order from the observed state and is direct evidence for order, adjacency, and visible controls. Grouped observed action sections are siblings, not nested groups; an action belongs only to the section object that contains it. If the request names a group, only actions inside that group satisfy it; relevant actions in sibling groups are not substitutes.';
const MAX_RENDERED_FACT_CHARS = 3_200;
const MAX_RENDERED_PROCEDURE_FACT_CHARS = 5_000;
const MAX_RETRIEVED_FACT_SECTION_CHARS = 3_800;
const MAX_RENDERED_EPISODE_CHARS = 200;
const MAX_FIELD_TEXT_CHARS = 700;
const MAX_QUERY_FOCUSED_LINES = 8;
const QUERY_RELEVANT_STEP_LIMIT = 6;
const QUERY_ANCHOR_LIMIT = 12;
const QUERY_ANCHOR_FULL_MATCH_SCORE = 1_000;
const MAX_OBSERVED_CONTROL_SEQUENCE_ITEMS = 48;
const CONTROL_SEQUENCE_QUERY_WINDOW_RADIUS = 3;
const FACT_GROUP_HEADER_ORDER = [
  L3_RELEVANT_FACTS_HEADER,
  L3_PROCEDURES_HEADER,
  L3_OUTCOMES_HEADER,
  L3_DECISIONS_RISKS_HEADER,
  L3_ARTIFACTS_SOURCES_HEADER,
  L3_SUMMARIES_HEADER,
];

function joinNonEmpty(parts: Array<string | null | undefined>, sep = '\n\n'): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(sep);
}

function sortBlocksDeterministically(blocks: MemoryBlock[]): MemoryBlock[] {
  return [...blocks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

function renderBlock(block: MemoryBlock): string {
  const description = block.description.trim();
  const content = block.content.trim();
  if (!content) return '';
  const head = description ? `${block.label} - ${description}` : block.label;
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
  if (blocks.length > 0) sections.push(`${L2_BLOCKS_HEADER}\n${blocks.join('\n\n')}`);
  if (dossier) sections.push(`${L2_DOSSIER_HEADER}\n${dossier}`);
  return sections.join('\n\n');
}

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

function dropEmptyPromptRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null || entry === '') return false;
      return !Array.isArray(entry) || entry.length > 0;
    }),
  );
}

function fitPromptValue(value: unknown, maxChars = MAX_FIELD_TEXT_CHARS): unknown {
  if (typeof value === 'string') return fitText(value, maxChars);
  if (Array.isArray(value)) {
    return value
      .slice(0, 24)
      .map((entry) => fitPromptValue(entry, maxChars))
      .filter((entry) => entry !== undefined && entry !== null && entry !== '');
  }
  if (value && typeof value === 'object') {
    return dropEmptyPromptRecord(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          fitPromptValue(entry, maxChars),
        ]),
      ),
    );
  }
  return value;
}

function queryHitCount(value: string, queryUnits: ReadonlySet<string> | null): number {
  if (!queryUnits || queryUnits.size === 0) return 0;
  const valueUnits = tokenizeLexicalUnits(value);
  let hits = 0;
  for (const unit of queryUnits) {
    if (valueUnits.has(unit)) hits += 1;
  }
  return hits;
}

function queryFocusedMultilineText(
  value: string,
  queryUnits: ReadonlySet<string> | null,
  maxChars: number,
): string | null {
  if (!queryUnits || queryUnits.size === 0) return null;
  const lines = value
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trimEnd(), index }))
    .filter((entry) => entry.line.trim().length > 0);
  if (lines.length < 4) return null;

  const scored = lines
    .map((entry) => ({
      ...entry,
      score: queryHitCount(entry.line, queryUnits),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .slice(0, MAX_QUERY_FOCUSED_LINES)
    .sort((left, right) => left.index - right.index);

  if (scored.length === 0) return null;
  return fitText(scored.map((entry) => entry.line).join('\n...\n'), maxChars);
}

function fitPromptEvidenceText(
  value: unknown,
  queryUnits: ReadonlySet<string> | null,
  maxChars = MAX_FIELD_TEXT_CHARS,
): unknown {
  if (typeof value !== 'string') return fitPromptValue(value, maxChars);
  return queryFocusedMultilineText(value, queryUnits, maxChars) ?? fitText(value, maxChars);
}

function promptStringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function compactPromptAffordance(entry: Record<string, unknown>): Record<string, unknown> {
  return dropEmptyPromptRecord({
    role: fitPromptValue(promptStringField(entry, 'role'), 80),
    label: fitPromptValue(promptStringField(entry, 'label'), 180),
    attributes: fitPromptValue(promptStringField(entry, 'attributes'), 160),
  });
}

function compactPromptControl(entry: Record<string, unknown>): Record<string, unknown> {
  return dropEmptyPromptRecord({
    role: fitPromptValue(promptStringField(entry, 'role'), 80),
    label: fitPromptValue(promptStringField(entry, 'label'), 180),
    attributes: fitPromptValue(promptStringField(entry, 'attributes'), 160),
    section: fitPromptValue(promptStringField(entry, 'section'), 180),
  });
}

function selectControlSequenceIndexes(
  value: ReadonlyArray<unknown>,
  queryUnits: ReadonlySet<string> | null,
  maxItems: number,
): number[] {
  if (!queryUnits || queryUnits.size === 0) {
    return value.slice(0, maxItems).map((_entry, index) => index);
  }

  const indexed = value.map((entry, index) => ({
    index,
    score: queryHitCount(JSON.stringify(entry), queryUnits),
  }));
  const matches = indexed
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    });
  if (matches.length === 0) return value.slice(0, maxItems).map((_entry, index) => index);

  const selected = new Set<number>();
  for (const match of matches) {
    for (
      let index = Math.max(0, match.index - CONTROL_SEQUENCE_QUERY_WINDOW_RADIUS);
      index <= Math.min(value.length - 1, match.index + CONTROL_SEQUENCE_QUERY_WINDOW_RADIUS);
      index += 1
    ) {
      selected.add(index);
      if (selected.size >= maxItems) break;
    }
    if (selected.size >= maxItems) break;
  }

  return Array.from(selected).sort((left, right) => left - right);
}

function compactObservedControlSequenceForPrompt(
  value: unknown,
  queryUnits: ReadonlySet<string> | null,
): unknown {
  if (!Array.isArray(value)) return fitPromptValue(value, 260);
  const compacted = selectControlSequenceIndexes(
    value,
    queryUnits,
    MAX_OBSERVED_CONTROL_SEQUENCE_ITEMS,
  )
    .map((index) => value[index])
    .map((entry): Record<string, unknown> | null => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const compact = compactPromptControl(entry as Record<string, unknown>);
      return Object.keys(compact).length > 0 ? compact : null;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  return compacted.length > 0 ? compacted : undefined;
}

function compactObservedAffordancesForPrompt(value: unknown): unknown {
  if (!Array.isArray(value)) return fitPromptValue(value, 260);

  const headings: string[] = [];
  const sectionActions = new Map<string, Array<Record<string, unknown>>>();
  const unsectionedActions: Array<Record<string, unknown>> = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const role = promptStringField(record, 'role');
    const label = promptStringField(record, 'label');
    if (role === 'heading' && label) {
      if (!headings.includes(label)) headings.push(label);
      continue;
    }

    const compact = compactPromptAffordance(record);
    if (Object.keys(compact).length === 0) continue;

    const section = promptStringField(record, 'section');
    if (section) {
      const entries = sectionActions.get(section) ?? [];
      entries.push(compact);
      sectionActions.set(section, entries);
    } else {
      unsectionedActions.push(compact);
    }
  }

  const sections = Array.from(sectionActions.entries()).map(([section, availableActions]) => ({
    section: fitText(section, 180),
    availableActions: availableActions.slice(0, 24),
  }));

  return fitPromptValue(
    dropEmptyPromptRecord({
      sections,
      unsectionedActions,
      headings,
    }),
    260,
  );
}

function compactProcedureStep(
  value: unknown,
  queryUnits: ReadonlySet<string> | null,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const compact = dropEmptyPromptRecord({
    stateIndex: input.stateIndex ?? input.state_index,
    url: fitPromptValue(input.url, 220),
    action: fitPromptValue(input.action, 260),
    thought: fitPromptValue(input.thought, 260),
    toolName: fitPromptValue(input.toolName ?? input.tool_name, 160),
    observedControlSequence: compactObservedControlSequenceForPrompt(
      input.observedControlSequence,
      queryUnits,
    ),
    observedAffordances: compactObservedAffordancesForPrompt(input.observedAffordances),
    inputControlsPresent: input.inputControlsPresent,
    observation: fitPromptEvidenceText(input.observation, queryUnits, 520),
    toolResult: fitPromptEvidenceText(input.toolResult ?? input.tool_result, queryUnits, 360),
    status: fitPromptValue(input.status, 160),
    outcome: fitPromptEvidenceText(input.outcome, queryUnits, 360),
  });
  return Object.keys(compact).length > 0 ? compact : null;
}

function stepEvidenceQueryScore(
  value: unknown,
  queryUnits: ReadonlySet<string> | null,
  anchorUnitSets: ReadonlyArray<ReadonlySet<string>>,
): number {
  if (!queryUnits || queryUnits.size === 0 || !value || typeof value !== 'object') return 0;
  const input = value as Record<string, unknown>;
  const structuredEvidence = JSON.stringify({
    observedControlSequence: input.observedControlSequence,
    observedAffordances: input.observedAffordances,
    toolResult: input.toolResult ?? input.tool_result,
    outcome: input.outcome,
  });
  const observedEvidence = String(input.observation ?? '');
  const actionContext = JSON.stringify({
    action: input.action,
    thought: input.thought,
    url: input.url,
    toolName: input.toolName ?? input.tool_name,
  });
  const stepUnits = tokenizeLexicalUnits(
    `${structuredEvidence}\n${observedEvidence}\n${actionContext}`,
  );
  const anchorScore = anchorUnitSets.filter((anchorUnits) => {
    if (anchorUnits.size === 0) return false;
    for (const unit of anchorUnits) {
      if (!stepUnits.has(unit)) return false;
    }
    return true;
  }).length;

  return (
    anchorScore * QUERY_ANCHOR_FULL_MATCH_SCORE +
    queryHitCount(structuredEvidence, queryUnits) * 4 +
    queryHitCount(observedEvidence, queryUnits) * 2 +
    queryHitCount(actionContext, queryUnits)
  );
}

function compactAgentSteps(
  value: unknown,
  queryUnits: ReadonlySet<string> | null,
  anchorUnitSets: ReadonlyArray<ReadonlySet<string>>,
  options: { prioritizeQueryMatches?: boolean } = {},
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const sourceSteps = options.prioritizeQueryMatches
    ? value
        .map((step, index) => ({
          step,
          index,
          score: stepEvidenceQueryScore(step, queryUnits, anchorUnitSets),
        }))
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          return right.index - left.index;
        })
        .slice(0, QUERY_RELEVANT_STEP_LIMIT)
        .map((entry) => entry.step)
    : value;
  const steps = sourceSteps.map((step) => compactProcedureStep(step, queryUnits)).filter(Boolean);
  return steps.length > 0 ? (steps as Array<Record<string, unknown>>) : undefined;
}

function compactProcedurePromptFields(
  parsed: Record<string, unknown> | null,
  queryUnits: ReadonlySet<string> | null,
  anchorUnitSets: ReadonlyArray<ReadonlySet<string>>,
): string | null {
  if (!parsed) return null;
  const steps = compactAgentSteps(parsed.steps, queryUnits, anchorUnitSets);
  const compact = dropEmptyPromptRecord({
    sourceRunId: parsed.sourceRunId,
    goal: fitPromptValue(parsed.goal),
    status: fitPromptValue(parsed.status, 240),
    outcome: fitPromptValue(parsed.outcome),
    domain: fitPromptValue(parsed.domain, 160),
    environment: fitPromptValue(parsed.environment, 160),
    tools: fitPromptValue(parsed.tools, 160),
    sources: fitPromptValue(parsed.sources, 260),
    waypoints: compactAgentSteps(parsed.waypoints, queryUnits, anchorUnitSets),
    steps,
  });
  return Object.keys(compact).length > 0 ? JSON.stringify(compact) : null;
}

function compactAgentEvidencePromptFields(
  parsed: Record<string, unknown> | null,
  queryUnits: ReadonlySet<string> | null,
  anchorUnitSets: ReadonlyArray<ReadonlySet<string>>,
): string | null {
  if (!parsed) return null;
  const compact = dropEmptyPromptRecord({
    sourceRunId: parsed.sourceRunId,
    status: fitPromptValue(parsed.status, 240),
    outcome: fitPromptValue(parsed.outcome),
    lastSteps: compactAgentSteps(parsed.lastSteps, queryUnits, anchorUnitSets, {
      prioritizeQueryMatches: true,
    }),
    artifacts: fitPromptValue(parsed.artifacts),
    decisions: fitPromptValue(parsed.decisions),
    risks: fitPromptValue(parsed.risks),
    summaries: fitPromptValue(parsed.summaries),
    tools: fitPromptValue(parsed.tools, 160),
    sources: fitPromptValue(parsed.sources, 260),
    goal: fitPromptValue(parsed.goal),
  });
  return Object.keys(compact).length > 0 ? JSON.stringify(compact) : null;
}

function promptFieldsForMemoryKind(kind: MemoryFactKind): ReadonlyArray<string> | null {
  switch (kind) {
    case 'goal':
      return ['goal', 'status', 'sourceRunId'];
    case 'tool_result':
    case 'outcome':
    case 'gotcha':
      return [
        'sourceRunId',
        'goal',
        'status',
        'outcome',
        'tools',
        'sources',
        'artifacts',
        'decisions',
        'risks',
        'summaries',
        'lastSteps',
      ];
    case 'decision':
      return ['decision', 'status', 'reason', 'sourceRunId'];
    case 'risk':
      return ['risk', 'status', 'mitigation', 'sourceRunId'];
    case 'artifact':
      return ['artifact', 'path', 'url', 'summary', 'sourceRunId'];
    case 'source':
      return ['source', 'url', 'title', 'summary', 'sourceRunId'];
    case 'summary':
      return ['summary', 'sourceRunId'];
    default:
      return null;
  }
}

function renderableFactText(
  fact: PromptMemoryFact,
  queryUnits: ReadonlySet<string> | null,
  anchorUnitSets: ReadonlyArray<ReadonlySet<string>>,
): string {
  const memoryKind = fact.memoryKind ?? 'semantic_fact';
  const parsed = parseJsonRecord(fact.objectText);
  if (memoryKind === 'procedure') {
    return compactProcedurePromptFields(parsed, queryUnits, anchorUnitSets) ?? fact.objectText;
  }
  if (memoryKind === 'outcome' || memoryKind === 'tool_result' || memoryKind === 'gotcha') {
    return compactAgentEvidencePromptFields(parsed, queryUnits, anchorUnitSets) ?? fact.objectText;
  }
  const fields = promptFieldsForMemoryKind(memoryKind);
  if (!fields) return fact.objectText;
  const fromAttributes = compactJsonFields({ ...(parsed ?? {}), ...fact.attributes }, fields);
  return fromAttributes || fact.objectText;
}

function renderFact(
  fact: PromptMemoryFact,
  queryUnits: ReadonlySet<string> | null,
  anchorUnitSets: ReadonlyArray<ReadonlySet<string>>,
): string {
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
    memoryKind === 'procedure' ? MAX_RENDERED_PROCEDURE_FACT_CHARS : MAX_RENDERED_FACT_CHARS;
  return `- ${subject} ${fact.predicate}: ${fitText(renderableFactText(fact, queryUnits, anchorUnitSets), maxChars)}${conf}${meta}`;
}

function renderEpisode(episode: MemoryEpisode): string {
  const summary = episode.summary.trim();
  if (!summary) return '';
  const tools = episode.toolNames.length > 0 ? ` [${episode.toolNames.join(', ')}]` : '';
  return `- ${fitText(summary, MAX_RENDERED_EPISODE_CHARS)}${tools}`;
}

function factGroupHeader(fact: PromptMemoryFact): string {
  const memoryKind = fact.memoryKind ?? 'semantic_fact';
  if (memoryKind === 'procedure') return L3_PROCEDURES_HEADER;
  if (memoryKind === 'outcome' || memoryKind === 'tool_result' || memoryKind === 'gotcha') {
    return L3_OUTCOMES_HEADER;
  }
  if (memoryKind === 'decision' || memoryKind === 'risk') return L3_DECISIONS_RISKS_HEADER;
  if (memoryKind === 'artifact' || memoryKind === 'source') return L3_ARTIFACTS_SOURCES_HEADER;
  if (memoryKind === 'summary') return L3_SUMMARIES_HEADER;
  return L3_RELEVANT_FACTS_HEADER;
}

function groupRetrievedFacts(facts: PromptMemoryFact[]): Array<{
  header: string;
  facts: PromptMemoryFact[];
}> {
  const byHeader = new Map<string, PromptMemoryFact[]>();
  const orderedHeaders: string[] = [];
  for (const fact of facts) {
    const header = factGroupHeader(fact);
    const list = byHeader.get(header) ?? [];
    if (list.length === 0) orderedHeaders.push(header);
    list.push(fact);
    byHeader.set(header, list);
  }
  const fixedHeaders = FACT_GROUP_HEADER_ORDER.filter((header) => byHeader.has(header));
  const remainingHeaders = orderedHeaders.filter(
    (header) => !FACT_GROUP_HEADER_ORDER.includes(header),
  );
  return [...fixedHeaders, ...remainingHeaders]
    .map((header) => ({ header, facts: byHeader.get(header) ?? [] }))
    .filter((group) => group.facts.length > 0);
}

function notesForHeader(header: string): string[] {
  if (header === L3_PROCEDURES_HEADER) return [L3_PROCEDURES_NOTE];
  if (header === L3_OUTCOMES_HEADER) return [L3_OUTCOMES_NOTE];
  return [];
}

function renderRetrievedFactGroup(
  group: { header: string; facts: PromptMemoryFact[] },
  queryUnits: ReadonlySet<string> | null,
  anchorUnitSets: ReadonlyArray<ReadonlySet<string>>,
): string[] {
  const sectionPrefix = `${L3_HEADER}\n${L3_FACTS_HEADER}\n${group.header}`;
  const sections: string[] = [];
  const noteLines = notesForHeader(group.header);
  let lines: string[] = [...noteLines];
  let sectionChars =
    sectionPrefix.length + noteLines.reduce((sum, line) => sum + 1 + line.length, 0);
  let hasFactInSection = false;

  for (const fact of group.facts) {
    const line = renderFact(fact, queryUnits, anchorUnitSets);
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

  if (lines.length > 0) sections.push(`${sectionPrefix}\n${lines.join('\n')}`);
  return sections;
}

function renderL3Sections(input: AssemblePromptInput): string[] {
  const focus = (input.focusBlock ?? '').trim();
  const reflection = (input.reflectionBlock ?? '').trim();
  const factGroups = groupRetrievedFacts(input.retrievedFacts ?? []);
  const queryUnits = input.retrievalQuery?.trim()
    ? tokenizeLexicalUnits(input.retrievalQuery)
    : null;
  const anchorUnitSets = input.retrievalQuery?.trim()
    ? quotedSpanUnitSets(input.retrievalQuery, QUERY_ANCHOR_LIMIT)
    : [];
  const episodes = (input.recentEpisodes ?? []).map(renderEpisode).filter((r) => r.length > 0);
  const addenda = joinNonEmpty(input.dynamicAddenda ?? []);

  const preludeParts: string[] = [];
  if (reflection) preludeParts.push(`${L3_REFLECTION_HEADER}\n${reflection}`);
  if (focus) preludeParts.push(focus);
  if (addenda) preludeParts.push(addenda);

  const sections: string[] = [];
  if (preludeParts.length > 0) sections.push(`${L3_HEADER}\n${preludeParts.join('\n\n')}`);
  if (factGroups.length > 0) {
    sections.push(
      ...factGroups.flatMap((group) => renderRetrievedFactGroup(group, queryUnits, anchorUnitSets)),
    );
  }
  if (episodes.length > 0) {
    sections.push(`${L3_HEADER}\n### Recent Activity\n${episodes.join('\n')}`);
  }
  return sections;
}

export interface AssemblePromptOutput {
  sections: SystemPromptSection[];
  /** Stable hash of the cacheable prefix. */
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
  return { sections, cacheableSignature: fnv1aHash(cacheableText) };
}

export function flattenPromptSections(sections: SystemPromptSection[]): string {
  return sections.map((section) => section.text).join('\n\n');
}
