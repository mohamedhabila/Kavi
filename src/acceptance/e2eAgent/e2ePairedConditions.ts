import {
  E2E_PAIRED_ROUTE_CONDITIONS,
  validateE2EPairedInvariantConfig,
  type E2EPairedInvariantConfig,
} from './e2ePairedInvariant';
import { stableHash, stableStringify } from './e2eTraceRedaction';

export const E2E_PAIRED_CONDITION_SCHEMA_VERSION = 'e2e-paired-condition-v5' as const;
export const E2E_PAIRED_PLAN_SCHEMA_VERSION = 'e2e-paired-plan-v5' as const;

export const E2E_PAIRED_CONDITIONS = [
  ...E2E_PAIRED_ROUTE_CONDITIONS,
  'memory_off',
  'diagnostic_full_context',
] as const;

export type E2EPairedCondition = (typeof E2E_PAIRED_CONDITIONS)[number];

export type E2EPairedConditionBehavior = Readonly<{
  routeOverride: 'production_auto' | 'forced_chitchat' | 'forced_agentic' | null;
  memoryMode: 'production' | 'off';
  contextMode: 'production' | 'full_context';
}>;

export type E2EPairedConditionPlan = Readonly<{
  schemaVersion: typeof E2E_PAIRED_CONDITION_SCHEMA_VERSION;
  condition: E2EPairedCondition;
  invariantConfig: E2EPairedInvariantConfig;
  invariantConfigHash: string;
  conditionConfig: E2EPairedConditionBehavior;
  conditionConfigHash: string;
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

function requireExactKeys(value: object, expectedKeys: ReadonlyArray<string>, label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(`${label} has an unsupported schema.`);
  }
}

function buildConditionBehavior(condition: E2EPairedCondition): E2EPairedConditionBehavior {
  return {
    routeOverride: E2E_PAIRED_ROUTE_CONDITIONS.includes(
      condition as (typeof E2E_PAIRED_ROUTE_CONDITIONS)[number],
    )
      ? (condition as (typeof E2E_PAIRED_ROUTE_CONDITIONS)[number])
      : null,
    memoryMode: condition === 'memory_off' ? 'off' : 'production',
    contextMode: condition === 'diagnostic_full_context' ? 'full_context' : 'production',
  };
}

export function buildE2EPairedConditionPlan(input: {
  condition: E2EPairedCondition;
  invariantConfig: E2EPairedInvariantConfig;
}): E2EPairedConditionPlan {
  if (!E2E_PAIRED_CONDITIONS.includes(input.condition)) {
    throw new Error(`Unsupported paired condition: ${String(input.condition)}`);
  }
  validateE2EPairedInvariantConfig(input.invariantConfig);
  const invariantConfig = deepFreeze(cloneJson(input.invariantConfig)) as E2EPairedInvariantConfig;
  const conditionConfig = buildConditionBehavior(input.condition);
  return deepFreeze({
    schemaVersion: E2E_PAIRED_CONDITION_SCHEMA_VERSION,
    condition: input.condition,
    invariantConfig,
    invariantConfigHash: canonicalHash(invariantConfig),
    conditionConfig,
    conditionConfigHash: canonicalHash(conditionConfig),
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
  const expectedBehavior = buildConditionBehavior(plan.condition);
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
