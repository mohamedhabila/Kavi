import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import type { ForegroundScenarioMemoryItemRecord } from './foregroundScenarioMemoryItemsEvidence';
import type { E2EMemoryItemExpectation, E2ERubric, E2EScenarioResult } from './types';

type E2EMemoryItemRubric = Extract<E2ERubric, { kind: 'memory_item' | 'memory_item_absent' }>;

const MAX_CONTAINED_TOKENS = 8;
const MAX_TOKEN_CHARS = 256;

function normalized(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase();
}

function isCanonicalTokenList(tokens: unknown): tokens is ReadonlyArray<string> {
  return (
    Array.isArray(tokens) &&
    tokens.length > 0 &&
    tokens.length <= MAX_CONTAINED_TOKENS &&
    tokens.every(
      (token) =>
        typeof token === 'string' &&
        token.length > 0 &&
        token === token.trim() &&
        token.length <= MAX_TOKEN_CHARS,
    )
  );
}

const EXPECTATION_KEYS = new Set(['contains', 'excludes']);

export function isCanonicalE2EMemoryItemExpectation(
  value: unknown,
): value is E2EMemoryItemExpectation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!Object.keys(value).every((key) => EXPECTATION_KEYS.has(key))) return false;
  const { contains, excludes } = value as { contains?: unknown; excludes?: unknown };
  return (
    isCanonicalTokenList(contains) && (excludes === undefined || isCanonicalTokenList(excludes))
  );
}

/** The item's text holds every expected token and no excluded one. */
export function memoryItemMatches(
  item: Pick<ForegroundScenarioMemoryItemRecord, 'text'>,
  expectation: E2EMemoryItemExpectation,
): boolean {
  const text = normalized(item.text);
  return (
    expectation.contains.every((token) => text.includes(normalized(token))) &&
    !(expectation.excludes ?? []).some((token) => text.includes(normalized(token)))
  );
}

export function describeMemoryItemExpectation(expectation: E2EMemoryItemExpectation): string {
  const excluded = expectation.excludes?.length ? ` not [${expectation.excludes.join(', ')}]` : '';
  return `[${expectation.contains.join(', ')}]${excluded}`;
}

export function evaluateE2EMemoryItemRubric(
  result: E2EScenarioResult,
  rubric: E2EMemoryItemRubric,
  fixtureId: string,
): AcceptanceFixtureOutcome {
  const { kind: _kind, ...expectation } = rubric;
  if (!isCanonicalE2EMemoryItemExpectation(expectation)) {
    return { fixtureId, passed: false, detail: 'memory item expectation is invalid' };
  }
  const current = result.memoryItems.items.filter((item) => item.supersededBy === null);
  const matched = current.some((item) => memoryItemMatches(item, expectation));
  const label = describeMemoryItemExpectation(expectation);
  if (rubric.kind === 'memory_item') {
    return matched
      ? { fixtureId, passed: true }
      : { fixtureId, passed: false, detail: `memory item missing: ${label}` };
  }
  return matched
    ? { fixtureId, passed: false, detail: `memory item present: ${label}` }
    : { fixtureId, passed: true };
}
