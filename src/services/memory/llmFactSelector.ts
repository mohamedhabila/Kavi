import type { LlmProviderConfig } from '../../types/provider';
import { createLogger } from '../../utils/logger';
import { createTimeoutSignal } from '../../utils/runtime';
import { performLlmFetch } from '../llm/core/fetchTransport';
import { sendLlmMessage } from '../llm/messageService';
import type { ChatCompletionMessage, StructuredOutputOptions } from '../llm/support/contracts';
import type { MemoryFactSelectionCandidate, MemoryFactSelector } from './factRecallTypes';
import { parseJsonRecord } from './factJson';
import { tokenizeLexicalUnits } from './ranking/lexical';

const logger = createLogger('memory.llmFactSelector');

const DEFAULT_SELECTOR_TIMEOUT_MS = 18_000;
const DEFAULT_SELECTOR_MAX_TOKENS = 1_024;
const MAX_CANDIDATE_TEXT_CHARS = 1_800;
const MAX_QUERY_CHARS = 2_000;
const MAX_STEP_TEXT_CHARS = 420;
const MAX_STEP_COUNT = 8;
const MAX_SELECTOR_AFFORDANCE_ITEMS = 18;
const MAX_SELECTOR_CONTROL_SEQUENCE_ITEMS = 36;
const CONTROL_SEQUENCE_QUERY_WINDOW_RADIUS = 3;

export interface LlmMemorySelectorConfig {
  provider: LlmProviderConfig;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

const SELECTION_SCHEMA: StructuredOutputOptions = {
  name: 'memory_evidence_selection',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['selectedFactIds'],
    properties: {
      selectedFactIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Memory fact ids, copied exactly from the provided candidates, ordered by usefulness.',
      },
    },
  },
};

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

function textHitCount(value: string, queryUnits: ReadonlySet<string>): number {
  if (queryUnits.size === 0) return 0;
  const valueUnits = tokenizeLexicalUnits(value);
  let hits = 0;
  for (const unit of queryUnits) {
    if (valueUnits.has(unit)) hits += 1;
  }
  return hits;
}

function fitUnknownValue(value: unknown, maxChars: number, arrayLimit = 12): unknown {
  if (typeof value === 'string') return fitText(value, maxChars);
  if (Array.isArray(value)) {
    return value
      .slice(0, arrayLimit)
      .map((entry) => fitUnknownValue(entry, maxChars, arrayLimit))
      .filter((entry) => entry !== undefined && entry !== null && entry !== '');
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [key, fitUnknownValue(entry, maxChars, arrayLimit)])
        .filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
    );
  }
  return value;
}

function compactObservedAffordancesForSelector(
  value: unknown,
  queryUnits: ReadonlySet<string>,
): unknown {
  if (!Array.isArray(value)) {
    return fitUnknownValue(value, MAX_STEP_TEXT_CHARS, MAX_SELECTOR_AFFORDANCE_ITEMS);
  }
  const selected: unknown[] = [];
  const seen = new Set<number>();
  const append = (entry: { index: number; value: unknown }): void => {
    if (selected.length >= MAX_SELECTOR_AFFORDANCE_ITEMS || seen.has(entry.index)) return;
    selected.push(entry.value);
    seen.add(entry.index);
  };
  const indexed = value.map((entry, index) => ({
    index,
    value: entry,
    score: textHitCount(JSON.stringify(entry), queryUnits),
  }));
  for (const entry of indexed
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })) {
    append(entry);
  }
  for (const entry of indexed) append(entry);
  return fitUnknownValue(selected, MAX_STEP_TEXT_CHARS, MAX_SELECTOR_AFFORDANCE_ITEMS);
}

function selectControlSequenceIndexes(
  value: ReadonlyArray<unknown>,
  queryUnits: ReadonlySet<string>,
  maxItems: number,
): number[] {
  if (queryUnits.size === 0) return value.slice(0, maxItems).map((_entry, index) => index);

  const indexed = value.map((entry, index) => ({
    index,
    score: textHitCount(JSON.stringify(entry), queryUnits),
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

function compactObservedControlSequenceForSelector(
  value: unknown,
  queryUnits: ReadonlySet<string>,
): unknown {
  if (!Array.isArray(value)) {
    return fitUnknownValue(value, MAX_STEP_TEXT_CHARS, MAX_SELECTOR_CONTROL_SEQUENCE_ITEMS);
  }
  const selected = selectControlSequenceIndexes(
    value,
    queryUnits,
    MAX_SELECTOR_CONTROL_SEQUENCE_ITEMS,
  ).map((index) => value[index]);
  return fitUnknownValue(selected, MAX_STEP_TEXT_CHARS, MAX_SELECTOR_CONTROL_SEQUENCE_ITEMS);
}

function compactStep(
  value: unknown,
  queryUnits: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const compact = {
    stateIndex: record.stateIndex ?? record.state_index,
    observedControlSequence: compactObservedControlSequenceForSelector(
      record.observedControlSequence,
      queryUnits,
    ),
    observedAffordances: compactObservedAffordancesForSelector(
      record.observedAffordances,
      queryUnits,
    ),
    inputControlsPresent: record.inputControlsPresent,
    observation: fitUnknownValue(record.observation, MAX_STEP_TEXT_CHARS),
    toolResult: fitUnknownValue(record.toolResult ?? record.tool_result, MAX_STEP_TEXT_CHARS),
    outcome: fitUnknownValue(record.outcome, MAX_STEP_TEXT_CHARS),
    action: fitUnknownValue(record.action, 240),
    thought: fitUnknownValue(record.thought, 240),
    status: fitUnknownValue(record.status, 120),
  };
  const entries = Object.entries(compact).filter(
    ([, entry]) => entry !== undefined && entry !== null && entry !== '',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function stepEvidenceScore(value: unknown, queryUnits: ReadonlySet<string>): number {
  if (queryUnits.size === 0 || !value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const structuredEvidence = JSON.stringify({
    observedControlSequence: record.observedControlSequence,
    observedAffordances: record.observedAffordances,
    toolResult: record.toolResult ?? record.tool_result,
    outcome: record.outcome,
  });
  const observedEvidence = String(record.observation ?? '');
  const actionContext = JSON.stringify({
    action: record.action,
    thought: record.thought,
    url: record.url,
    toolName: record.toolName ?? record.tool_name,
  });
  return (
    textHitCount(structuredEvidence, queryUnits) * 4 +
    textHitCount(observedEvidence, queryUnits) * 2 +
    textHitCount(actionContext, queryUnits)
  );
}

function selectStepsForPrompt(
  steps: unknown,
  queryUnits: ReadonlySet<string>,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(steps) || steps.length === 0) return undefined;
  const indexed = steps
    .map((step, index) => ({
      index,
      step,
      score: stepEvidenceScore(step, queryUnits),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.index - left.index;
    });

  const queryMatched = indexed.filter((entry) => entry.score > 0).slice(0, MAX_STEP_COUNT);
  const selected =
    queryMatched.length > 0
      ? queryMatched
      : steps.slice(-MAX_STEP_COUNT).map((step, offset) => ({
          index: steps.length - Math.min(steps.length, MAX_STEP_COUNT) + offset,
          step,
          score: 0,
        }));

  const compacted = selected
    .map((entry) => compactStep(entry.step, queryUnits))
    .filter(Boolean) as Array<Record<string, unknown>>;
  return compacted.length > 0 ? compacted : undefined;
}

function selectorEvidenceText(
  candidate: MemoryFactSelectionCandidate,
  queryUnits: ReadonlySet<string>,
): string {
  const fact = candidate.fact;
  const parsed = parseJsonRecord(fact.objectText);
  if (!parsed) return fitText(fact.objectText, MAX_CANDIDATE_TEXT_CHARS);
  const compact = {
    sourceRunId: parsed.sourceRunId,
    status: fitUnknownValue(parsed.status, 120),
    outcome: fitUnknownValue(parsed.outcome, 500),
    steps: selectStepsForPrompt(parsed.steps ?? parsed.lastSteps, queryUnits),
    waypoints: selectStepsForPrompt(parsed.waypoints, queryUnits),
    summaries: fitUnknownValue(parsed.summaries, 500),
    decisions: fitUnknownValue(parsed.decisions, 500),
    risks: fitUnknownValue(parsed.risks, 500),
    artifacts: fitUnknownValue(parsed.artifacts, 500),
    sources: fitUnknownValue(parsed.sources, 300),
    goal: fitUnknownValue(parsed.goal, 500),
  };
  const entries = Object.entries(compact).filter(
    ([, entry]) =>
      entry !== undefined &&
      entry !== null &&
      entry !== '' &&
      (!Array.isArray(entry) || entry.length > 0),
  );
  return fitText(JSON.stringify(Object.fromEntries(entries)), MAX_CANDIDATE_TEXT_CHARS);
}

function candidateForPrompt(
  candidate: MemoryFactSelectionCandidate,
  index: number,
  queryUnits: ReadonlySet<string>,
): object {
  const fact = candidate.fact;
  return {
    rank: index + 1,
    factId: fact.id,
    kind: fact.memoryKind,
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    sourceRunId: fact.sourceRunId,
    score: Number(candidate.score.toFixed(4)),
    relevanceScore: Number(candidate.relevanceScore.toFixed(4)),
    textScore: Number(candidate.textScore.toFixed(4)),
    text: selectorEvidenceText(candidate, queryUnits),
  };
}

function parsedFactIds(response: unknown): string[] {
  const record =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const parsed = record.output_parsed;
  const parsedRecord =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const value = parsedRecord.selectedFactIds;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

export function createLlmMemoryFactSelector(
  config: LlmMemorySelectorConfig | undefined,
): MemoryFactSelector | undefined {
  const provider = config?.provider;
  if (!provider || provider.enabled === false) return undefined;
  const model = (config.model || provider.model || '').trim();
  if (!model) return undefined;

  return async ({ query, limit, targetCount, candidates }) => {
    if (candidates.length === 0) return { factIds: [] };
    const queryUnits = tokenizeLexicalUnits(query);
    const messages: ChatCompletionMessage[] = [
      {
        role: 'system',
        content:
          'Rerank the provided memory records into a compact evidence slate for the current user request. Do not answer the request. Return only record ids from the provided candidates. Prefer direct observed evidence over broad topical similarity. Return targetSelected ids unless fewer candidates have plausible relevance; the caller already bounded the pool, so do not stop at the first plausible record when nearby candidates may establish presence, absence, conflict, or complementary evidence.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          request: fitText(query, MAX_QUERY_CHARS),
          maxSelected: limit,
          targetSelected: Math.max(1, Math.min(targetCount, candidates.length, limit)),
          candidates: candidates.map((candidate, index) =>
            candidateForPrompt(candidate, index, queryUnits),
          ),
        }),
      },
    ];

    try {
      const response = await sendLlmMessage({
        provider,
        messages,
        performFetch: performLlmFetch,
        options: {
          model,
          maxTokens: config.maxTokens ?? DEFAULT_SELECTOR_MAX_TOKENS,
          reasoning_effort: 'none',
          signal: createTimeoutSignal(config.timeoutMs ?? DEFAULT_SELECTOR_TIMEOUT_MS),
          structuredOutput: SELECTION_SCHEMA,
        },
      });
      return { factIds: parsedFactIds(response).slice(0, limit) };
    } catch (error) {
      logger.devWarn(
        'Memory fact selector failed:',
        error instanceof Error ? error.message : String(error),
      );
      return { factIds: [] };
    }
  };
}
