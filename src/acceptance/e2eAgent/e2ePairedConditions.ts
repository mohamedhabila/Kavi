import type { MemoryRememberArgs } from '../../services/memory/memoryTools';
import {
  E2E_PAIRED_ROUTE_CONDITIONS,
  validateE2EPairedInvariantConfig,
  type E2EPairedInvariantConfig,
} from './e2ePairedInvariant';
import { stableHash, stableStringify } from './e2eTraceRedaction';

export const E2E_PAIRED_CONDITION_SCHEMA_VERSION = 'e2e-paired-condition-v1' as const;
export const E2E_PAIRED_PLAN_SCHEMA_VERSION = 'e2e-paired-plan-v2' as const;

export const E2E_PAIRED_CONDITIONS = [
  ...E2E_PAIRED_ROUTE_CONDITIONS,
  'memory_off',
  'lexical_baseline',
  'diagnostic_full_context',
  'oracle_evidence',
] as const;

export const E2E_MAX_ORACLE_FACTS = 32;
const MEMORY_ENTITY_TYPES = [
  'person',
  'place',
  'org',
  'project',
  'thing',
  'concept',
  'event',
  'self',
] as const;
const MEMORY_FACT_SCOPES = ['global', 'project', 'conversation', 'session', 'persona'] as const;
const MEMORY_REMEMBER_KEYS = new Set([
  'subject',
  'subjectType',
  'predicate',
  'value',
  'confidence',
  'pinned',
  'scope',
  'originConversationId',
  'originThreadId',
  'originTaskId',
  'sourceMessageId',
  'sourceRunId',
  'sourceSummary',
  'importance',
]);

export type E2EPairedCondition = (typeof E2E_PAIRED_CONDITIONS)[number];

export type E2EOracleEvidenceDeclaration = Readonly<{
  interface: 'memory_remember';
  allowSeeding: true;
  facts: ReadonlyArray<Readonly<MemoryRememberArgs>>;
}>;

export type E2EPairedConditionBehavior = Readonly<{
  routeOverride: 'production_auto' | 'forced_chitchat' | 'forced_agentic' | null;
  memoryMode: 'production' | 'off';
  retrievalMode: 'production' | 'lexical_only';
  contextMode: 'production' | 'full_context';
  oracleEvidenceHash: string | null;
  oracleEvidenceCount: number;
}>;

export type E2EPairedConditionPlan = Readonly<{
  schemaVersion: typeof E2E_PAIRED_CONDITION_SCHEMA_VERSION;
  condition: E2EPairedCondition;
  invariantConfig: E2EPairedInvariantConfig;
  invariantConfigHash: string;
  conditionConfig: E2EPairedConditionBehavior;
  conditionConfigHash: string;
  oracleEvidence?: E2EOracleEvidenceDeclaration;
}>;

export type E2EPairedExecutionPlan = Readonly<{
  schemaVersion: typeof E2E_PAIRED_PLAN_SCHEMA_VERSION;
  pairId: string;
  comparison: Readonly<{
    referenceCondition: E2EPairedCondition;
    candidateCondition: E2EPairedCondition;
  }>;
  conditions: ReadonlyArray<E2EPairedConditionPlan>;
}>;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalHash(value: unknown): string {
  return stableHash(stableStringify(value));
}

function requireTrimmed(value: string, label: string, maxLength = 10_000): string {
  if (!value || value !== value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty canonical string.`);
  }
  return value;
}

function requireExactKeys(
  value: object,
  expectedKeys: ReadonlyArray<string>,
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(`${label} has an unsupported schema.`);
  }
}

function requireUnitInterval(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite number between 0 and 1.`);
  }
  return value;
}

function canonicalNullableString(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null.`);
  return requireTrimmed(value, label, maxLength);
}

export function validateE2EOracleEvidenceDeclaration(
  evidence: E2EOracleEvidenceDeclaration | undefined,
): E2EOracleEvidenceDeclaration {
  if (!evidence || evidence.interface !== 'memory_remember' || evidence.allowSeeding !== true) {
    throw new Error('oracle_evidence requires an explicitly allowed memory_remember declaration.');
  }
  if (!Array.isArray(evidence.facts) || evidence.facts.length === 0) {
    throw new Error('oracle_evidence requires at least one declared fact.');
  }
  if (evidence.facts.length > E2E_MAX_ORACLE_FACTS) {
    throw new Error(`oracle_evidence accepts at most ${E2E_MAX_ORACLE_FACTS} declared facts.`);
  }

  const canonicalFacts = new Map<string, Readonly<MemoryRememberArgs>>();
  for (const [index, fact] of evidence.facts.entries()) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
      throw new Error(`oracleEvidence.facts[${index}] must be an object.`);
    }
    if (Object.keys(fact).some((key) => !MEMORY_REMEMBER_KEYS.has(key))) {
      throw new Error(`oracleEvidence.facts[${index}] contains unsupported fields.`);
    }
    const canonicalFact: MemoryRememberArgs = {
      subject: requireTrimmed(fact.subject, `oracleEvidence.facts[${index}].subject`, 80),
      predicate: requireTrimmed(
        fact.predicate,
        `oracleEvidence.facts[${index}].predicate`,
        80,
      ),
      value: requireTrimmed(fact.value, `oracleEvidence.facts[${index}].value`, 200),
      scope: 'global',
    };
    if (fact.subjectType !== undefined) {
      if (!MEMORY_ENTITY_TYPES.includes(fact.subjectType)) {
        throw new Error(`oracleEvidence.facts[${index}].subjectType is unsupported.`);
      }
      canonicalFact.subjectType = fact.subjectType;
    }
    if (fact.confidence !== undefined) {
      canonicalFact.confidence = requireUnitInterval(
        fact.confidence,
        `oracleEvidence.facts[${index}].confidence`,
      );
    }
    if (fact.pinned !== undefined) {
      if (typeof fact.pinned !== 'boolean') {
        throw new Error(`oracleEvidence.facts[${index}].pinned must be a boolean.`);
      }
      canonicalFact.pinned = fact.pinned;
    }
    if (fact.scope !== undefined) {
      if (!MEMORY_FACT_SCOPES.includes(fact.scope)) {
        throw new Error(`oracleEvidence.facts[${index}].scope is unsupported.`);
      }
      canonicalFact.scope = fact.scope;
    }
    canonicalOptionalOracleStrings(canonicalFact, fact, index);
    if (fact.importance !== undefined) {
      canonicalFact.importance = requireUnitInterval(
        fact.importance,
        `oracleEvidence.facts[${index}].importance`,
      );
    }
    canonicalFacts.set(stableStringify(canonicalFact), canonicalFact);
  }

  const facts = Array.from(canonicalFacts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, fact]) => fact);
  return deepFreeze({ interface: 'memory_remember', allowSeeding: true, facts });
}

function canonicalOptionalOracleStrings(
  target: MemoryRememberArgs,
  source: Readonly<MemoryRememberArgs>,
  index: number,
): void {
  const assign = (
    key:
      | 'originConversationId'
      | 'originThreadId'
      | 'originTaskId'
      | 'sourceMessageId'
      | 'sourceRunId'
      | 'sourceSummary',
    maxLength: number,
  ): void => {
    const value = source[key];
    if (value !== undefined) {
      target[key] = canonicalNullableString(
        value,
        `oracleEvidence.facts[${index}].${key}`,
        maxLength,
      );
    }
  };
  assign('originConversationId', 512);
  assign('originThreadId', 512);
  assign('originTaskId', 512);
  assign('sourceMessageId', 512);
  assign('sourceRunId', 512);
  assign('sourceSummary', 1_000);
}

function buildConditionBehavior(
  condition: E2EPairedCondition,
  oracleEvidence: E2EOracleEvidenceDeclaration | undefined,
): E2EPairedConditionBehavior {
  const oracle =
    condition === 'oracle_evidence'
      ? validateE2EOracleEvidenceDeclaration(oracleEvidence)
      : undefined;
  if (condition !== 'oracle_evidence' && oracleEvidence !== undefined) {
    throw new Error('Oracle evidence may only be supplied to the oracle_evidence condition.');
  }
  return {
    routeOverride: E2E_PAIRED_ROUTE_CONDITIONS.includes(
      condition as (typeof E2E_PAIRED_ROUTE_CONDITIONS)[number],
    )
      ? (condition as (typeof E2E_PAIRED_ROUTE_CONDITIONS)[number])
      : null,
    memoryMode: condition === 'memory_off' ? 'off' : 'production',
    retrievalMode: condition === 'lexical_baseline' ? 'lexical_only' : 'production',
    contextMode: condition === 'diagnostic_full_context' ? 'full_context' : 'production',
    oracleEvidenceHash: oracle ? canonicalHash(oracle) : null,
    oracleEvidenceCount: oracle?.facts.length ?? 0,
  };
}

export function buildE2EPairedConditionPlan(input: {
  condition: E2EPairedCondition;
  invariantConfig: E2EPairedInvariantConfig;
  oracleEvidence?: E2EOracleEvidenceDeclaration;
}): E2EPairedConditionPlan {
  if (!E2E_PAIRED_CONDITIONS.includes(input.condition)) {
    throw new Error(`Unsupported paired condition: ${String(input.condition)}`);
  }
  validateE2EPairedInvariantConfig(input.invariantConfig);
  const invariantConfig = deepFreeze(cloneJson(input.invariantConfig)) as E2EPairedInvariantConfig;
  const conditionConfig = buildConditionBehavior(input.condition, input.oracleEvidence);
  const oracleEvidence =
    input.condition === 'oracle_evidence'
      ? validateE2EOracleEvidenceDeclaration(input.oracleEvidence)
      : undefined;
  return deepFreeze({
    schemaVersion: E2E_PAIRED_CONDITION_SCHEMA_VERSION,
    condition: input.condition,
    invariantConfig,
    invariantConfigHash: canonicalHash(invariantConfig),
    conditionConfig,
    conditionConfigHash: canonicalHash(conditionConfig),
    ...(oracleEvidence ? { oracleEvidence } : {}),
  }) as E2EPairedConditionPlan;
}

function validateConditionPlan(plan: E2EPairedConditionPlan): void {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('Paired condition plan must be an object.');
  }
  requireExactKeys(
    plan,
    [
      'schemaVersion',
      'condition',
      'invariantConfig',
      'invariantConfigHash',
      'conditionConfig',
      'conditionConfigHash',
      ...(plan.condition === 'oracle_evidence' ? ['oracleEvidence'] : []),
    ],
    'Paired condition plan',
  );
  if (plan.schemaVersion !== E2E_PAIRED_CONDITION_SCHEMA_VERSION) {
    throw new Error('Paired condition plan uses an unsupported schema version.');
  }
  if (!E2E_PAIRED_CONDITIONS.includes(plan.condition)) {
    throw new Error(`Unsupported paired condition: ${String(plan.condition)}`);
  }
  validateE2EPairedInvariantConfig(plan.invariantConfig);
  if (plan.condition === 'oracle_evidence') {
    const canonicalOracle = validateE2EOracleEvidenceDeclaration(plan.oracleEvidence);
    if (stableStringify(plan.oracleEvidence) !== stableStringify(canonicalOracle)) {
      throw new Error('oracle_evidence has a non-canonical declaration.');
    }
  }
  const expectedBehavior = buildConditionBehavior(plan.condition, plan.oracleEvidence);
  if (stableStringify(plan.conditionConfig) !== stableStringify(expectedBehavior)) {
    throw new Error(`Condition ${plan.condition} has a non-canonical condition config.`);
  }
  if (plan.invariantConfigHash !== canonicalHash(plan.invariantConfig)) {
    throw new Error(`Condition ${plan.condition} has a stale invariant config hash.`);
  }
  if (plan.conditionConfigHash !== canonicalHash(plan.conditionConfig)) {
    throw new Error(`Condition ${plan.condition} has a stale condition config hash.`);
  }
}

export function validateE2EPairedExecutionPlan(plan: E2EPairedExecutionPlan): void {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('Paired execution plan must be an object.');
  }
  requireExactKeys(
    plan,
    ['schemaVersion', 'pairId', 'comparison', 'conditions'],
    'Paired execution plan',
  );
  if (plan.schemaVersion !== E2E_PAIRED_PLAN_SCHEMA_VERSION) {
    throw new Error('Paired execution plan uses an unsupported schema version.');
  }
  requireTrimmed(plan.pairId, 'pairId', 256);
  if (!Array.isArray(plan.conditions) || plan.conditions.length !== 2) {
    throw new Error('A paired execution plan requires exactly two conditions.');
  }
  for (const condition of plan.conditions) validateConditionPlan(condition);
  if (new Set(plan.conditions.map((condition) => condition.condition)).size !== 2) {
    throw new Error('A paired execution plan must not duplicate a condition.');
  }
  if (!plan.comparison || typeof plan.comparison !== 'object' || Array.isArray(plan.comparison)) {
    throw new Error('Paired execution plan comparison must be an object.');
  }
  requireExactKeys(
    plan.comparison,
    ['referenceCondition', 'candidateCondition'],
    'Paired execution plan comparison',
  );
  if (
    plan.comparison.referenceCondition !== plan.conditions[0].condition ||
    plan.comparison.candidateCondition !== plan.conditions[1].condition
  ) {
    throw new Error('Paired execution plan order must match its declared comparison roles.');
  }
  const [left, right] = plan.conditions;
  if (
    left.invariantConfigHash !== right.invariantConfigHash ||
    stableStringify(left.invariantConfig) !== stableStringify(right.invariantConfig)
  ) {
    throw new Error('Paired conditions do not share an identical invariant configuration.');
  }
}

export function buildE2EPairedExecutionPlan(input: {
  pairId: string;
  comparison: E2EPairedExecutionPlan['comparison'];
  conditions: ReadonlyArray<E2EPairedConditionPlan>;
}): E2EPairedExecutionPlan {
  const plan = deepFreeze({
    schemaVersion: E2E_PAIRED_PLAN_SCHEMA_VERSION,
    pairId: requireTrimmed(input.pairId, 'pairId', 256),
    comparison: cloneJson(input.comparison),
    conditions: cloneJson(input.conditions),
  }) as E2EPairedExecutionPlan;
  validateE2EPairedExecutionPlan(plan);
  return plan;
}
