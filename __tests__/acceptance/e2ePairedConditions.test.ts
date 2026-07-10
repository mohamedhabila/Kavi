import {
  E2E_PAIRED_CONDITIONS,
  buildE2EPairedConditionPlan,
  buildE2EPairedExecutionPlan,
  validateE2EPairedExecutionPlan,
  type E2EOracleEvidenceDeclaration,
  type E2EPairedConditionPlan,
  type E2EPairedExecutionPlan,
} from '../../src/acceptance/e2eAgent/e2ePairedConditions';
import { buildE2EPairedInvariantConfig } from '../../src/acceptance/e2eAgent/e2ePairedInvariant';
import type { E2EScenario } from '../../src/acceptance/e2eAgent/types';
import type { LlmProviderConfig } from '../../src/types/provider';

function makeProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'provider-id',
    name: 'Provider name',
    enabled: true,
    kind: 'remote',
    protocol: 'openai-chat',
    providerFamily: 'custom',
    baseUrl: 'https://example.com/v1',
    apiKey: 'secret-api-key',
    model: 'model-id',
    capabilityHints: {
      supportsTools: true,
      supportsPromptCaching: true,
    },
    modelCapabilities: {
      'model-id': { vision: false, tools: true, fileInput: true },
    },
    ...overrides,
  };
}

function makeScenario(overrides: Partial<E2EScenario> = {}): E2EScenario {
  return {
    id: 'paired-scenario',
    conversationId: 'paired-conversation',
    contentClass: 'synthetic_public',
    execution: { initialMode: 'agentic', route: 'production_auto' },
    threadTitle: 'Synthetic paired thread',
    prompt: 'Complete the paired scenario.',
    userTurns: [
      { content: 'Remember the first constraint.', route: 'production_auto' },
      {
        content: 'Use the constraint after relaunch.',
        route: 'production_auto',
        lifecycleBefore: 'app_relaunch',
      },
    ],
    rubrics: [{ kind: 'min_user_turns', min: 2 }],
    initialMessages: [],
    initialWorkspaceFiles: [{ path: 'input.txt', content: 'paired fixture' }],
    ...overrides,
  };
}

function makeInvariant(
  overrides: Partial<Parameters<typeof buildE2EPairedInvariantConfig>[0]> = {},
) {
  return buildE2EPairedInvariantConfig({
    provider: makeProvider(),
    scenario: makeScenario(),
    systemPrompt: 'Stable system prompt.',
    toolSurface: ['memory_recall', 'memory_search', 'memory_recall'],
    maxTokens: 4_096,
    scenarioTimeoutMs: 90_000,
    perTurnTimeoutMs: 30_000,
    memoryTimeoutMs: 10_000,
    seed: 42,
    ...overrides,
  });
}

function makeCondition(
  condition: (typeof E2E_PAIRED_CONDITIONS)[number],
  invariantConfig = makeInvariant(),
  oracleEvidence?: E2EOracleEvidenceDeclaration,
): E2EPairedConditionPlan {
  return buildE2EPairedConditionPlan({ condition, invariantConfig, oracleEvidence });
}

describe('paired E2E condition contract', () => {
  it('exposes only the seven declared condition labels and canonical behavior', () => {
    expect(E2E_PAIRED_CONDITIONS).toEqual([
      'production_auto',
      'forced_chitchat',
      'forced_agentic',
      'memory_off',
      'lexical_baseline',
      'diagnostic_full_context',
      'oracle_evidence',
    ]);

    const invariant = makeInvariant();
    expect(makeCondition('production_auto', invariant).conditionConfig).toMatchObject({
      routeOverride: 'production_auto',
      memoryMode: 'production',
      retrievalMode: 'production',
      contextMode: 'production',
    });
    expect(makeCondition('forced_chitchat', invariant).conditionConfig.routeOverride).toBe(
      'forced_chitchat',
    );
    expect(makeCondition('forced_agentic', invariant).conditionConfig.routeOverride).toBe(
      'forced_agentic',
    );
    expect(makeCondition('memory_off', invariant).conditionConfig.memoryMode).toBe('off');
    expect(makeCondition('lexical_baseline', invariant).conditionConfig.retrievalMode).toBe(
      'lexical_only',
    );
    expect(
      makeCondition('diagnostic_full_context', invariant).conditionConfig.contextMode,
    ).toBe('full_context');
  });

  it('canonicalizes the tool surface and freezes the entire invariant', () => {
    const invariant = makeInvariant();
    expect(invariant.toolSurface).toEqual(['memory_recall', 'memory_search']);
    expect(invariant.toolSurfaceDefinitionHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(invariant)).toBe(true);
    expect(Object.isFrozen(invariant.provider)).toBe(true);
    expect(Object.isFrozen(invariant.scenarioInput.userTurns)).toBe(true);
    expect(Object.isFrozen(invariant.budget)).toBe(true);
  });

  it('never serializes provider credentials, private endpoints, or local locators', () => {
    const provider = makeProvider({
      id: 'PRIVATE-PROVIDER-ID',
      name: 'PRIVATE-PROVIDER-NAME',
      baseUrl:
        'https://PRIVATE-USER:PRIVATE-PASSWORD@PRIVATE-HOST.invalid/v1?token=PRIVATE-QUERY-TOKEN',
      apiKey: 'PRIVATE-API-KEY',
      apiKeyRef: 'PRIVATE-API-KEY-REF',
      model: '/Users/private/PRIVATE-MODEL-PATH/model.gguf',
      local: {
        runtime: 'litert-lm',
        backend: 'gpu',
        catalogModelIds: ['PRIVATE-CATALOG-ID'],
        installedModels: [
          {
            modelId: 'PRIVATE-LOCAL-MODEL-ID',
            fileName: 'PRIVATE-FILE-NAME',
            localPath: '/Users/private/PRIVATE-LOCAL-PATH/model.bin',
            installedAt: 1,
            sourceUrl: 'https://PRIVATE-SOURCE.invalid/model?token=PRIVATE-SOURCE-TOKEN',
            repositoryId: 'PRIVATE-REPOSITORY-ID',
            downloadRevision: 'PRIVATE-REVISION',
          },
        ],
      },
    });
    const serialized = JSON.stringify(makeInvariant({ provider }));
    for (const sentinel of [
      'PRIVATE-PROVIDER-ID',
      'PRIVATE-PROVIDER-NAME',
      'PRIVATE-USER',
      'PRIVATE-PASSWORD',
      'PRIVATE-HOST',
      'PRIVATE-QUERY-TOKEN',
      'PRIVATE-API-KEY',
      'PRIVATE-API-KEY-REF',
      'PRIVATE-MODEL-PATH',
      'PRIVATE-CATALOG-ID',
      'PRIVATE-LOCAL-MODEL-ID',
      'PRIVATE-FILE-NAME',
      'PRIVATE-LOCAL-PATH',
      'PRIVATE-SOURCE',
      'PRIVATE-SOURCE-TOKEN',
      'PRIVATE-REPOSITORY-ID',
      'PRIVATE-REVISION',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(serialized).not.toContain('baseUrl');
    expect(serialized).not.toContain('apiKey');
  });

  it('rejects secret-bearing fields smuggled into a loaded invariant', () => {
    const invariant = makeInvariant();
    const tainted = {
      ...invariant,
      provider: { ...invariant.provider, apiKey: 'PRIVATE-SMUGGLED-KEY' },
    } as typeof invariant;
    expect(() => makeCondition('production_auto', tainted)).toThrow(
      'invariantConfig.provider has an unsupported schema',
    );
  });

  it('ignores credential rotation while detecting behaviorally different endpoints', () => {
    const left = makeInvariant({
      provider: makeProvider({
        apiKey: 'first-key',
        apiKeyRef: 'first-ref',
        baseUrl: 'https://user:first@example.com/v1?token=first#one',
      }),
    });
    const credentialRotation = makeInvariant({
      provider: makeProvider({
        apiKey: 'second-key',
        apiKeyRef: 'second-ref',
        baseUrl: 'https://other:second@example.com/v1/?token=second#two',
      }),
    });
    const endpointChange = makeInvariant({
      provider: makeProvider({ baseUrl: 'https://different.example.com/v1' }),
    });

    expect(credentialRotation.provider).toEqual(left.provider);
    expect(endpointChange.provider.endpointHash).not.toBe(left.provider.endpointHash);
  });

  it('requires exactly two distinct conditions with identical invariant configuration', () => {
    const invariant = makeInvariant();
    const production = makeCondition('production_auto', invariant);
    const memoryOff = makeCondition('memory_off', invariant);
    const plan = buildE2EPairedExecutionPlan({
      pairId: 'memory-ablation',
      comparison: {
        referenceCondition: 'production_auto',
        candidateCondition: 'memory_off',
      },
      conditions: [production, memoryOff],
    });
    expect(plan.conditions).toHaveLength(2);
    expect(Object.isFrozen(plan.conditions)).toBe(true);

    expect(() =>
      buildE2EPairedExecutionPlan({
        pairId: 'missing',
        comparison: {
          referenceCondition: 'production_auto',
          candidateCondition: 'memory_off',
        },
        conditions: [production],
      }),
    ).toThrow('exactly two conditions');
    expect(() =>
      buildE2EPairedExecutionPlan({
        pairId: 'duplicate',
        comparison: {
          referenceCondition: 'production_auto',
          candidateCondition: 'production_auto',
        },
        conditions: [production, production],
      }),
    ).toThrow('must not duplicate');
    expect(() =>
      buildE2EPairedExecutionPlan({
        pairId: 'mismatch',
        comparison: {
          referenceCondition: 'production_auto',
          candidateCondition: 'memory_off',
        },
        conditions: [production, makeCondition('memory_off', makeInvariant({ seed: 43 }))],
      }),
    ).toThrow('identical invariant configuration');
    expect(() =>
      buildE2EPairedExecutionPlan({
        pairId: 'reversed-role-declaration',
        comparison: {
          referenceCondition: 'memory_off',
          candidateCondition: 'production_auto',
        },
        conditions: [production, memoryOff],
      }),
    ).toThrow('order must match its declared comparison roles');
  });

  it('rejects stale hashes instead of accepting a mutated condition', () => {
    const invariant = makeInvariant();
    const production = makeCondition('production_auto', invariant);
    const tampered = {
      ...makeCondition('memory_off', invariant),
      conditionConfigHash: 'sha256:stale',
    } as E2EPairedConditionPlan;
    const plan = {
      schemaVersion: 'e2e-paired-plan-v2',
      pairId: 'tampered',
      comparison: {
        referenceCondition: 'production_auto',
        candidateCondition: 'memory_off',
      },
      conditions: [production, tampered],
    } as E2EPairedExecutionPlan;
    expect(() => validateE2EPairedExecutionPlan(plan)).toThrow('stale condition config hash');
  });

  it('requires explicit oracle permission and canonical bounded product facts', () => {
    const invariant = makeInvariant();
    expect(() => makeCondition('oracle_evidence', invariant)).toThrow(
      'explicitly allowed memory_remember declaration',
    );
    expect(() =>
      makeCondition('production_auto', invariant, {
        interface: 'memory_remember',
        allowSeeding: true,
        facts: [{ subject: 'user', predicate: 'preference', value: 'tea' }],
      }),
    ).toThrow('only be supplied');

    const duplicateFact = {
      subject: 'user',
      subjectType: 'self' as const,
      predicate: 'preference',
      value: 'tea',
      confidence: 0.9,
      pinned: true,
      scope: 'global' as const,
      originConversationId: null,
      sourceSummary: 'Declared synthetic oracle fact.',
      importance: 1,
    };
    const oracle = makeCondition('oracle_evidence', invariant, {
      interface: 'memory_remember',
      allowSeeding: true,
      facts: [duplicateFact, duplicateFact],
    });
    expect(oracle.oracleEvidence?.facts).toEqual([duplicateFact]);
    expect(oracle.conditionConfig.oracleEvidenceCount).toBe(1);
    expect(oracle.conditionConfig.oracleEvidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);

    expect(() =>
      makeCondition('oracle_evidence', invariant, {
        interface: 'memory_remember',
        allowSeeding: true,
        facts: Array.from({ length: 33 }, (_, index) => ({
          subject: 'user',
          predicate: `fact-${index}`,
          value: 'value',
        })),
      }),
    ).toThrow('at most 32');
    expect(() =>
      makeCondition('oracle_evidence', invariant, {
        interface: 'memory_remember',
        allowSeeding: true,
        facts: [
          {
            subject: 'user',
            predicate: 'preference',
            value: 'tea',
            confidence: 2,
          },
        ],
      }),
    ).toThrow('between 0 and 1');
    expect(() =>
      makeCondition('oracle_evidence', invariant, {
        interface: 'memory_remember',
        allowSeeding: true,
        facts: [
          {
            subject: 'user',
            predicate: 'preference',
            value: 'tea',
            promptInjection: 'PRIVATE-ORACLE-PROMPT',
          } as never,
        ],
      }),
    ).toThrow('unsupported fields');
  });

  it('validates budgets, seeds, and canonical identifiers at construction', () => {
    expect(() => makeInvariant({ maxTokens: 0 })).toThrow('positive safe integer');
    expect(() => makeInvariant({ seed: -1 })).toThrow('unsigned 32-bit integer');
    expect(() => makeInvariant({ seed: 0x1_0000_0000 })).toThrow('unsigned 32-bit integer');
    expect(() =>
      buildE2EPairedExecutionPlan({
        pairId: ' padded ',
        comparison: {
          referenceCondition: 'production_auto',
          candidateCondition: 'memory_off',
        },
        conditions: [makeCondition('production_auto'), makeCondition('memory_off')],
      }),
    ).toThrow('canonical string');
  });
});
