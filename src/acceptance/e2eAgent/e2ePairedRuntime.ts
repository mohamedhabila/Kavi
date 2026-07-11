import type { LlmProviderConfig } from '../../types/provider';
import { seedE2EOracleEvidence } from './e2eOracleEvidenceSeeder';
import { evaluateE2EScenarioRubrics } from './rubricEvaluators';
import {
  validateE2EPairedExecutionPlan,
  type E2EPairedConditionPlan,
  type E2EPairedExecutionPlan,
} from './e2ePairedConditions';
import { buildE2EPairedInvariantConfig } from './e2ePairedInvariant';
import {
  resetAndVerifyE2EPairedConditionState,
  withE2EPairedStoreIsolation,
} from './e2ePairedStateIsolation';
import { buildE2EProvider } from './providerConfig';
import {
  resolveE2EScenarioSystemPrompt,
  runE2EScenario,
  type E2EScenarioRunOptions,
} from './scenarioRunner';
import { stableHash, stableStringify } from './e2eTraceRedaction';
import type { E2EScenario, E2EScenarioResult } from './types';

export const E2E_PAIRED_RUNTIME_SCHEMA_VERSION = 'e2e-paired-runtime-v2' as const;

export type E2EPairedConditionExecutionInput = Readonly<{
  conditionPlan: E2EPairedConditionPlan;
  scenario: E2EScenario;
  runOptions: E2EScenarioRunOptions;
}>;

export type E2EPairedRuntimeResult = Readonly<{
  schemaVersion: typeof E2E_PAIRED_RUNTIME_SCHEMA_VERSION;
  pairIdHash: string;
  invariantConfigHash: string;
  comparison: E2EPairedExecutionPlan['comparison'];
  executionSeed: number;
  executionOrder: ReadonlyArray<E2EPairedConditionPlan['condition']>;
  conditions: ReadonlyArray<E2EPairedConditionExecution>;
  cleanup: E2EPairedCleanupResult;
  validForDeltaClaims: boolean;
}>;

type E2EPairedConditionExecutionBase = Readonly<{
  condition: E2EPairedConditionPlan['condition'];
  conditionConfigHash: string;
  executionIdentityHash: string;
  oracleEvidenceCount: number;
}>;

export type E2EPairedConditionExecution =
  | (E2EPairedConditionExecutionBase &
      Readonly<{
        status: 'completed';
        result: E2EScenarioResult;
        assessment: Readonly<{
          executionCompleted: boolean;
          rubricPassed: number;
          rubricTotal: number;
          passed: boolean;
        }>;
      }>)
  | (E2EPairedConditionExecutionBase &
      Readonly<{
        status: 'failed';
        category: 'state_reset' | 'condition_execution' | 'evidence_validation';
        errorHash: string;
        privateError: string;
      }>);

export type E2EPairedCleanupResult =
  | Readonly<{ status: 'completed' }>
  | Readonly<{
      status: 'failed';
      category: 'state_cleanup' | 'store_restoration';
      errorHash: string;
      privateError: string;
    }>;

export type E2EPairedRuntimeDependencies = Readonly<{
  buildProvider: () => LlmProviderConfig;
  resetConditionState: () => Promise<void>;
  cleanupConditionState: () => Promise<void>;
  withStoreIsolation: <T>(task: () => Promise<T>) => Promise<T>;
  executeCondition: (input: E2EPairedConditionExecutionInput) => Promise<E2EScenarioResult>;
}>;

const DEFAULT_DEPENDENCIES: E2EPairedRuntimeDependencies = {
  buildProvider: buildE2EProvider,
  resetConditionState: resetAndVerifyE2EPairedConditionState,
  cleanupConditionState: async () => {
    await resetAndVerifyE2EPairedConditionState();
  },
  withStoreIsolation: withE2EPairedStoreIsolation,
  executeCondition: async ({ scenario, runOptions }) => {
    return runE2EScenario(scenario, runOptions);
  },
};

function buildConditionRunOptions(
  plan: E2EPairedExecutionPlan,
  conditionPlan: E2EPairedConditionPlan,
  provider: LlmProviderConfig,
  conversationIdSuffix: string,
): E2EScenarioRunOptions {
  const invariant = conditionPlan.invariantConfig;
  const oracleEvidence = conditionPlan.oracleEvidence;
  return {
    provider,
    maxTokens: invariant.budget.maxTokens,
    scenarioTimeoutMs: invariant.budget.scenarioTimeoutMs,
    perTurnTimeoutMs: invariant.budget.perTurnTimeoutMs,
    memoryTimeoutMs: invariant.budget.memoryTimeoutMs,
    ...(conditionPlan.conditionConfig.routeOverride
      ? { routeOverride: conditionPlan.conditionConfig.routeOverride }
      : {}),
    disableLongTermMemory: conditionPlan.conditionConfig.memoryMode === 'off',
    memoryRetrievalStrategy: conditionPlan.conditionConfig.retrievalMode,
    memoryContextStrategy: conditionPlan.conditionConfig.contextMode,
    enableCompaction: conditionPlan.conditionConfig.contextMode !== 'full_context',
    conversationIdSuffix,
    allowedToolNames: invariant.toolSurface,
    ...(oracleEvidence
      ? {
          beforeTurns: async (identity: {
            conversationId: string;
            workspaceConversationId: string;
          }) => {
            validateE2EPairedExecutionPlan(plan);
            await seedE2EOracleEvidence({ declaration: oracleEvidence, ...identity });
          },
        }
      : {}),
  };
}

function privateFailure(error: unknown): { privateError: string; errorHash: string } {
  const privateError =
    error instanceof Error
      ? `${error.name}: ${error.message}`.slice(0, 10_000)
      : String(error).slice(0, 10_000);
  return { privateError, errorHash: stableHash(privateError) };
}

function failedCondition(
  plan: E2EPairedConditionPlan,
  executionIdentityHash: string,
  category: Extract<E2EPairedConditionExecution, { status: 'failed' }>['category'],
  error: unknown,
): E2EPairedConditionExecution {
  return {
    condition: plan.condition,
    conditionConfigHash: plan.conditionConfigHash,
    executionIdentityHash,
    oracleEvidenceCount: plan.conditionConfig.oracleEvidenceCount,
    status: 'failed',
    category,
    ...privateFailure(error),
  };
}

function failedCleanup(
  category: Extract<E2EPairedCleanupResult, { status: 'failed' }>['category'],
  error: unknown,
): E2EPairedCleanupResult {
  return { status: 'failed', category, ...privateFailure(error) };
}

function validateRuntimeInvariant(input: {
  plan: E2EPairedExecutionPlan;
  provider: LlmProviderConfig;
  scenario: E2EScenario;
}): void {
  const invariant = input.plan.conditions[0].invariantConfig;
  const actual = buildE2EPairedInvariantConfig({
    provider: input.provider,
    scenario: input.scenario,
    systemPrompt: resolveE2EScenarioSystemPrompt(input.scenario),
    toolSurface: invariant.toolSurface,
    maxTokens: invariant.budget.maxTokens,
    scenarioTimeoutMs: invariant.budget.scenarioTimeoutMs,
    perTurnTimeoutMs: invariant.budget.perTurnTimeoutMs,
    memoryTimeoutMs: invariant.budget.memoryTimeoutMs,
    seed: invariant.seed,
  });
  if (stableStringify(actual) !== stableStringify(invariant)) {
    throw new Error('Paired runtime inputs do not match the frozen invariant configuration.');
  }
}

function validateConditionResult(
  result: E2EScenarioResult,
  scenario: E2EScenario,
  condition: E2EPairedConditionPlan['condition'],
  conversationIdSuffix: string,
): void {
  if (result.fixtureId !== scenario.id || result.contentClass !== scenario.contentClass) {
    throw new Error(`Condition ${condition} returned evidence for a different scenario.`);
  }
  if (!result.conversationId.endsWith(`-${conversationIdSuffix}`)) {
    throw new Error(`Condition ${condition} returned evidence from an unisolated conversation.`);
  }
}

export function resolveE2EPairedExecutionOrder(
  comparison: E2EPairedExecutionPlan['comparison'],
  seed: number,
): ReadonlyArray<E2EPairedConditionPlan['condition']> {
  return seed % 2 === 0
    ? [comparison.referenceCondition, comparison.candidateCondition]
    : [comparison.candidateCondition, comparison.referenceCondition];
}

export function buildE2EPairedExecutionIdentityHash(input: {
  pairIdHash: string;
  seed: number;
  condition: E2EPairedConditionPlan['condition'];
}): string {
  return stableHash(
    stableStringify({
      namespace: 'e2e-paired-condition-v1',
      pairIdHash: input.pairIdHash,
      seed: input.seed,
      condition: input.condition,
    }),
  );
}

function conversationIdSuffix(executionIdentityHash: string): string {
  return `paired-${executionIdentityHash.slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

export async function runE2EPairedConditions(input: {
  plan: E2EPairedExecutionPlan;
  scenario: E2EScenario;
  provider?: LlmProviderConfig;
  dependencies?: Partial<E2EPairedRuntimeDependencies>;
}): Promise<E2EPairedRuntimeResult> {
  validateE2EPairedExecutionPlan(input.plan);
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  const provider = input.provider ?? dependencies.buildProvider();
  validateRuntimeInvariant({ plan: input.plan, provider, scenario: input.scenario });
  const pairIdHash = stableHash(input.plan.pairId);
  const executionSeed = input.plan.conditions[0].invariantConfig.seed;
  const executionOrder = resolveE2EPairedExecutionOrder(input.plan.comparison, executionSeed);
  const conditionPlans = new Map(
    input.plan.conditions.map((conditionPlan) => [conditionPlan.condition, conditionPlan]),
  );
  const executionIdentities = new Map(
    input.plan.conditions.map((conditionPlan) => [
      conditionPlan.condition,
      buildE2EPairedExecutionIdentityHash({
        pairIdHash,
        seed: executionSeed,
        condition: conditionPlan.condition,
      }),
    ]),
  );
  if (new Set(executionIdentities.values()).size !== input.plan.conditions.length) {
    throw new Error('Paired conditions must use distinct execution identities.');
  }

  let capturedResult: E2EPairedRuntimeResult | undefined;
  try {
    return await dependencies.withStoreIsolation(async () => {
      const conditionResults = new Map<
        E2EPairedConditionPlan['condition'],
        E2EPairedConditionExecution
      >();
      let cleanup: E2EPairedCleanupResult = { status: 'completed' };
      try {
        for (const condition of executionOrder) {
          const conditionPlan = conditionPlans.get(condition);
          const executionIdentityHash = executionIdentities.get(condition);
          if (!conditionPlan || !executionIdentityHash) {
            throw new Error('Paired execution order references an unknown condition.');
          }
          const identitySuffix = conversationIdSuffix(executionIdentityHash);
          try {
            await dependencies.resetConditionState();
          } catch (error) {
            conditionResults.set(
              condition,
              failedCondition(conditionPlan, executionIdentityHash, 'state_reset', error),
            );
            continue;
          }
          let result: E2EScenarioResult;
          try {
            result = await dependencies.executeCondition({
              conditionPlan,
              scenario: input.scenario,
              runOptions: buildConditionRunOptions(
                input.plan,
                conditionPlan,
                provider,
                identitySuffix,
              ),
            });
          } catch (error) {
            conditionResults.set(
              condition,
              failedCondition(conditionPlan, executionIdentityHash, 'condition_execution', error),
            );
            continue;
          }
          try {
            validateConditionResult(
              result,
              input.scenario,
              conditionPlan.condition,
              identitySuffix,
            );
            const rubricOutcomes = evaluateE2EScenarioRubrics(result, input.scenario.rubrics);
            const rubricPassed = rubricOutcomes.filter((outcome) => outcome.passed).length;
            conditionResults.set(condition, {
              condition: conditionPlan.condition,
              conditionConfigHash: conditionPlan.conditionConfigHash,
              executionIdentityHash,
              oracleEvidenceCount: conditionPlan.conditionConfig.oracleEvidenceCount,
              status: 'completed',
              result,
              assessment: {
                executionCompleted: result.completed,
                rubricPassed,
                rubricTotal: rubricOutcomes.length,
                passed: result.completed && rubricPassed === rubricOutcomes.length,
              },
            });
          } catch (error) {
            conditionResults.set(
              condition,
              failedCondition(conditionPlan, executionIdentityHash, 'evidence_validation', error),
            );
          }
        }
      } finally {
        try {
          await dependencies.cleanupConditionState();
        } catch (error) {
          cleanup = failedCleanup('state_cleanup', error);
        }
      }
      const conditions = input.plan.conditions.flatMap((conditionPlan) => {
        const result = conditionResults.get(conditionPlan.condition);
        return result ? [result] : [];
      });
      capturedResult = {
        schemaVersion: E2E_PAIRED_RUNTIME_SCHEMA_VERSION,
        pairIdHash,
        invariantConfigHash: input.plan.conditions[0].invariantConfigHash,
        comparison: input.plan.comparison,
        executionSeed,
        executionOrder,
        conditions,
        cleanup,
        validForDeltaClaims:
          cleanup.status === 'completed' &&
          conditions.length === input.plan.conditions.length &&
          conditions.every((condition) => condition.status === 'completed'),
      };
      return capturedResult;
    });
  } catch (error) {
    if (!capturedResult) throw error;
    return {
      ...capturedResult,
      cleanup: failedCleanup('store_restoration', error),
      validForDeltaClaims: false,
    };
  }
}
