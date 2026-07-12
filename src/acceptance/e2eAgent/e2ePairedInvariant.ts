import { TOOL_DEFINITIONS } from '../../engine/tools/definitions';
import type { LlmProviderConfig } from '../../types/provider';
import {
  buildE2EPairedProviderInvariant,
  validateE2EPairedProviderInvariant,
  type E2EPairedProviderInvariant,
} from './e2ePairedProviderInvariant';
import { stableHash, stableStringify } from './e2eTraceRedaction';
import type { E2EScenario } from './types';
import {
  validateE2EPairedCausalMemoryContract,
  validateE2EPairedCausalMemoryDefinition,
} from './e2ePairedCausalMemoryContract';

export const E2E_PAIRED_ROUTE_CONDITIONS = [
  'production_auto',
  'forced_chitchat',
  'forced_agentic',
] as const;

export type E2EPairedInvariantConfig = Readonly<{
  provider: E2EPairedProviderInvariant;
  systemPrompt: string;
  toolSurface: ReadonlyArray<string>;
  toolSurfaceDefinitionHash: string;
  scenarioInput: Readonly<{
    fixtureId: string;
    conversationId: string;
    contentClass: E2EScenario['contentClass'];
    execution: E2EScenario['execution'];
    threadTitle: string | null;
    prompt: string;
    userTurns: ReadonlyArray<
      Readonly<{
        content: string;
        route: NonNullable<E2EScenario['userTurns']>[number]['route'] | null;
        lifecycleBefore: NonNullable<E2EScenario['userTurns']>[number]['lifecycleBefore'] | null;
        selectedMode: NonNullable<E2EScenario['userTurns']>[number]['selectedMode'] | null;
      }>
    >;
    rubrics: E2EScenario['rubrics'];
    pairedEvaluation: NonNullable<E2EScenario['pairedEvaluation']> | null;
    initialMessages: NonNullable<E2EScenario['initialMessages']>;
    initialWorkspaceFiles: NonNullable<E2EScenario['initialWorkspaceFiles']>;
  }>;
  budget: Readonly<{
    maxTokens: number;
    scenarioTimeoutMs: number;
    perTurnTimeoutMs: number;
    memoryTimeoutMs: number;
  }>;
  seed: number;
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

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function requireSeed(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('seed must be an unsigned 32-bit integer.');
  }
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash.`);
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

function canonicalToolSurface(values: ReadonlyArray<string>): string[] {
  const normalized = Array.from(
    new Set(values.map((value) => requireTrimmed(value, 'toolSurface entry', 200))),
  ).sort((left, right) => left.localeCompare(right));
  if (normalized.length === 0) throw new Error('toolSurface must not be empty.');
  return normalized;
}

function toolSurfaceDefinitionHash(toolSurface: ReadonlyArray<string>): string {
  const allowed = new Set(toolSurface);
  const definitions = TOOL_DEFINITIONS.filter((tool) => allowed.has(tool.name)).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  if (definitions.length !== toolSurface.length) {
    throw new Error('toolSurface contains a tool outside the foreground product runtime.');
  }
  return canonicalHash(definitions);
}

function canonicalScenarioInput(scenario: E2EScenario): E2EPairedInvariantConfig['scenarioInput'] {
  const pairedEvaluation = validateE2EPairedCausalMemoryContract(scenario);
  const turns =
    scenario.userTurns && scenario.userTurns.length > 0
      ? scenario.userTurns
      : [{ content: scenario.prompt }];
  return {
    fixtureId: requireTrimmed(scenario.id, 'scenario.id', 256),
    conversationId: requireTrimmed(scenario.conversationId, 'scenario.conversationId', 256),
    contentClass: scenario.contentClass,
    execution: cloneJson(scenario.execution),
    threadTitle:
      scenario.threadTitle === undefined
        ? null
        : requireTrimmed(scenario.threadTitle, 'scenario.threadTitle', 10_000),
    prompt: requireTrimmed(scenario.prompt, 'scenario.prompt', 100_000),
    userTurns: turns.map((turn, index) => ({
      content: requireTrimmed(turn.content, `scenario.userTurns[${index}].content`, 100_000),
      route: turn.route ?? null,
      lifecycleBefore: turn.lifecycleBefore ?? null,
      selectedMode: turn.selectedMode ?? null,
    })),
    rubrics: cloneJson(scenario.rubrics),
    pairedEvaluation: pairedEvaluation ? cloneJson(pairedEvaluation) : null,
    initialMessages: cloneJson(scenario.initialMessages ?? []),
    initialWorkspaceFiles: cloneJson(scenario.initialWorkspaceFiles ?? []),
  };
}

export function resolveDefaultE2EPairedToolSurface(): string[] {
  return canonicalToolSurface(TOOL_DEFINITIONS.map((tool) => tool.name));
}

export function buildE2EPairedInvariantConfig(input: {
  provider: LlmProviderConfig;
  scenario: E2EScenario;
  systemPrompt: string;
  toolSurface: ReadonlyArray<string>;
  maxTokens: number;
  scenarioTimeoutMs: number;
  perTurnTimeoutMs: number;
  memoryTimeoutMs: number;
  seed: number;
}): E2EPairedInvariantConfig {
  const toolSurface = canonicalToolSurface(input.toolSurface);
  const config: E2EPairedInvariantConfig = {
    provider: buildE2EPairedProviderInvariant(input.provider),
    systemPrompt: requireTrimmed(input.systemPrompt, 'systemPrompt', 100_000),
    toolSurface,
    toolSurfaceDefinitionHash: toolSurfaceDefinitionHash(toolSurface),
    scenarioInput: canonicalScenarioInput(input.scenario),
    budget: {
      maxTokens: requirePositiveSafeInteger(input.maxTokens, 'budget.maxTokens'),
      scenarioTimeoutMs: requirePositiveSafeInteger(
        input.scenarioTimeoutMs,
        'budget.scenarioTimeoutMs',
      ),
      perTurnTimeoutMs: requirePositiveSafeInteger(
        input.perTurnTimeoutMs,
        'budget.perTurnTimeoutMs',
      ),
      memoryTimeoutMs: requirePositiveSafeInteger(input.memoryTimeoutMs, 'budget.memoryTimeoutMs'),
    },
    seed: requireSeed(input.seed),
  };
  validateE2EPairedInvariantConfig(config);
  return deepFreeze(cloneJson(config)) as E2EPairedInvariantConfig;
}

export function validateE2EPairedInvariantConfig(config: E2EPairedInvariantConfig): void {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('invariantConfig must be an object.');
  }
  requireExactKeys(
    config,
    [
      'provider',
      'systemPrompt',
      'toolSurface',
      'toolSurfaceDefinitionHash',
      'scenarioInput',
      'budget',
      'seed',
    ],
    'invariantConfig',
  );
  validateE2EPairedProviderInvariant(config.provider);
  requireTrimmed(config.systemPrompt, 'invariantConfig.systemPrompt', 100_000);
  const canonicalTools = canonicalToolSurface(config.toolSurface);
  if (stableStringify(config.toolSurface) !== stableStringify(canonicalTools)) {
    throw new Error('invariantConfig.toolSurface must be canonical.');
  }
  requireHash(config.toolSurfaceDefinitionHash, 'invariantConfig.toolSurfaceDefinitionHash');
  if (config.toolSurfaceDefinitionHash !== toolSurfaceDefinitionHash(canonicalTools)) {
    throw new Error('invariantConfig.toolSurfaceDefinitionHash does not match the product tools.');
  }
  validateScenarioInvariant(config.scenarioInput);
  validateBudgetInvariant(config.budget);
  requireSeed(config.seed);
}

function validateScenarioInvariant(config: E2EPairedInvariantConfig['scenarioInput']): void {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('invariantConfig.scenarioInput must be an object.');
  }
  requireExactKeys(
    config,
    [
      'fixtureId',
      'conversationId',
      'contentClass',
      'execution',
      'threadTitle',
      'prompt',
      'userTurns',
      'rubrics',
      'pairedEvaluation',
      'initialMessages',
      'initialWorkspaceFiles',
    ],
    'invariantConfig.scenarioInput',
  );
  requireTrimmed(config.fixtureId, 'invariantConfig.scenarioInput.fixtureId', 256);
  requireTrimmed(config.conversationId, 'invariantConfig.scenarioInput.conversationId', 256);
  if (!['private', 'synthetic_public'].includes(config.contentClass)) {
    throw new Error('invariantConfig.scenarioInput.contentClass is unsupported.');
  }
  requireExactKeys(
    config.execution,
    ['initialMode', 'route'],
    'invariantConfig.scenarioInput.execution',
  );
  if (!['agentic', 'chitchat'].includes(config.execution.initialMode)) {
    throw new Error('invariantConfig.scenarioInput.execution.initialMode is unsupported.');
  }
  if (!E2E_PAIRED_ROUTE_CONDITIONS.includes(config.execution.route)) {
    throw new Error('invariantConfig.scenarioInput.execution.route is unsupported.');
  }
  if (config.threadTitle !== null) {
    requireTrimmed(config.threadTitle, 'invariantConfig.scenarioInput.threadTitle', 10_000);
  }
  requireTrimmed(config.prompt, 'invariantConfig.scenarioInput.prompt', 100_000);
  if (
    !Array.isArray(config.rubrics) ||
    !Array.isArray(config.initialMessages) ||
    !Array.isArray(config.initialWorkspaceFiles)
  ) {
    throw new Error('invariantConfig.scenarioInput collections must be arrays.');
  }
  if (config.pairedEvaluation !== null) {
    validateE2EPairedCausalMemoryDefinition(config.pairedEvaluation, config.rubrics);
  }
  if (!Array.isArray(config.userTurns) || config.userTurns.length === 0) {
    throw new Error('invariantConfig.scenarioInput.userTurns must not be empty.');
  }
  for (const [index, turn] of config.userTurns.entries()) {
    requireExactKeys(
      turn,
      ['content', 'route', 'lifecycleBefore', 'selectedMode'],
      `invariantConfig.scenarioInput.userTurns[${index}]`,
    );
    requireTrimmed(
      turn.content,
      `invariantConfig.scenarioInput.userTurns[${index}].content`,
      100_000,
    );
    if (turn.route !== null && !E2E_PAIRED_ROUTE_CONDITIONS.includes(turn.route)) {
      throw new Error(`invariantConfig.scenarioInput.userTurns[${index}].route is unsupported.`);
    }
    if (
      turn.lifecycleBefore !== null &&
      !['app_relaunch', 'new_conversation'].includes(turn.lifecycleBefore)
    ) {
      throw new Error(
        `invariantConfig.scenarioInput.userTurns[${index}].lifecycleBefore is unsupported.`,
      );
    }
    if (turn.selectedMode !== null && !['agentic', 'chitchat'].includes(turn.selectedMode)) {
      throw new Error(
        `invariantConfig.scenarioInput.userTurns[${index}].selectedMode is unsupported.`,
      );
    }
  }
}

function validateBudgetInvariant(config: E2EPairedInvariantConfig['budget']): void {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('invariantConfig.budget must be an object.');
  }
  requireExactKeys(
    config,
    ['maxTokens', 'scenarioTimeoutMs', 'perTurnTimeoutMs', 'memoryTimeoutMs'],
    'invariantConfig.budget',
  );
  requirePositiveSafeInteger(config.maxTokens, 'invariantConfig.budget.maxTokens');
  requirePositiveSafeInteger(config.scenarioTimeoutMs, 'invariantConfig.budget.scenarioTimeoutMs');
  requirePositiveSafeInteger(config.perTurnTimeoutMs, 'invariantConfig.budget.perTurnTimeoutMs');
  requirePositiveSafeInteger(config.memoryTimeoutMs, 'invariantConfig.budget.memoryTimeoutMs');
}
