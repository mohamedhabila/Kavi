import type { Message } from '../types/message';
import { upsertEntity } from '../services/memory/entities';
import { buildUnifiedMemoryAccessContext } from '../services/memory/memoryAccessGateway';
import {
  buildMemoryRetrievalScopeHash,
  readRecentMemoryRetrievalEvents,
} from '../services/memory/retrievalLog';
import { getMemoryDb } from '../services/memory/database';
import { stableHash, stableStringify } from './e2eAgent/e2eTraceRedaction';
import {
  ACCEPTANCE_FACT_PRODUCER_IDS,
  recordAcceptanceFixtureFact,
} from './acceptanceFactContributions';
import { runInIsolatedStructuredMemoryEvaluation } from './structuredMemoryEvaluation';
import {
  MEMORY_HYBRID_ABLATION_CASES,
  MEMORY_HYBRID_ABLATION_FIXTURE_SIGNATURE,
  MEMORY_HYBRID_ABLATION_FIXTURE_VERSION,
  type MemoryHybridAblationCase,
  type MemoryHybridAblationFamily,
} from './memoryHybridAblationFixtures';

type CandidateStrategy = 'lexical' | 'hybrid';

type CaseResult = Readonly<{
  family: MemoryHybridAblationFamily;
  expected: boolean;
  targetHit: boolean;
  pollution: boolean;
  selectedKeys: ReadonlyArray<string>;
}>;

export type MemoryHybridAblationReport = Readonly<{
  schemaVersion: 'memory-hybrid-ablation-report-v2';
  fixtureVersion: typeof MEMORY_HYBRID_ABLATION_FIXTURE_VERSION;
  fixtureSignature: typeof MEMORY_HYBRID_ABLATION_FIXTURE_SIGNATURE;
  claimClass: 'diagnostic_only';
  downstreamAnswerEvaluated: false;
  executionPath: 'foreground_product';
  caseCount: number;
  lexicalControl: Readonly<{
    caseCount: number;
    identicalSelectionCount: number;
    lexicalRecallAtOne: number;
    hybridRecallAtOne: number;
  }>;
  productRetrieval: Readonly<{
    caseCount: number;
    lexicalRecallAtOne: number;
    hybridRecallAtOne: number;
    hybridRecallGain: number;
  }>;
  diagnosticTarget: Readonly<{
    minimumHybridRecallGain: 0.2;
    met: boolean;
    releaseGate: false;
  }>;
  pollution: Readonly<{
    lexicalCaseCount: number;
    hybridCaseCount: number;
    hybridOnlyRegressionCount: number;
    lexicalNegativeFalsePositiveCount: number;
    hybridNegativeFalsePositiveCount: number;
  }>;
  families: Readonly<
    Record<
      'entity' | 'temporal' | 'local_similarity',
      Readonly<{
        caseCount: number;
        lexicalTargetHitCount: number;
        hybridTargetHitCount: number;
      }>
    >
  >;
}>;

function assertFrozenFixtureSignature(): void {
  const actual = stableHash(stableStringify(MEMORY_HYBRID_ABLATION_CASES));
  if (actual !== MEMORY_HYBRID_ABLATION_FIXTURE_SIGNATURE) {
    throw new Error('Frozen hybrid ablation fixture signature mismatch.');
  }
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function namespaceFor(fixture: MemoryHybridAblationCase, strategy: CandidateStrategy): string {
  return `ablation-${fixture.id}-${strategy}`;
}

function seedFixture(
  fixture: MemoryHybridAblationCase,
  strategy: CandidateStrategy,
): ReadonlyMap<string, string> {
  const namespace = namespaceFor(fixture, strategy);
  const entityIds = new Map(
    fixture.entities.map((entity) => [
      entity.key,
      upsertEntity({
        name: `${namespace} ${entity.name}`,
        type: entity.type,
        ...(entity.aliases ? { aliases: [...entity.aliases] } : {}),
        now: fixture.now,
      }).id,
    ]),
  );
  const factKeysById = new Map<string, string>();
  const addFact = (seed: MemoryHybridAblationCase['facts'][number]) => {
    const subjectId = entityIds.get(seed.entityKey);
    if (!subjectId) throw new Error(`Unknown hybrid ablation entity key: ${seed.entityKey}`);
    const originConversationId =
      seed.origin === 'active' ? namespace : `${namespace}-other-conversation`;
    const recorded = recordAcceptanceFixtureFact(
      {
        subjectId,
        predicate: seed.predicate,
        objectText: seed.objectText,
        scope: 'conversation',
        originConversationId,
        supersedePrior: false,
        now: seed.now,
        ...(seed.validAt !== undefined ? { validAt: seed.validAt } : {}),
        ...(seed.expiresAt !== undefined ? { expiresAt: seed.expiresAt } : {}),
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
      {
        producerId: ACCEPTANCE_FACT_PRODUCER_IDS.memoryHybridAblation,
        fixtureId: fixture.id,
        eventKey: `${strategy}:${seed.key}`,
        memoryConversationId: originConversationId,
        sourceThreadId: originConversationId,
        taskId: null,
        sourceKind: 'turn',
        sourceId: `${namespace}-seed-${seed.key}`,
      },
    );
    factKeysById.set(recorded.fact.id, seed.key);
    if (seed.deleted) {
      getMemoryDb().runSync(
        'UPDATE memory_facts SET deleted_at = ? WHERE id = ?',
        seed.now,
        recorded.fact.id,
      );
    }
  };
  fixture.facts.forEach(addFact);
  if (fixture.generatedDistractors) {
    const generated = fixture.generatedDistractors;
    for (let index = 0; index < generated.count; index += 1) {
      addFact({
        key: `generated-${index}`,
        entityKey: generated.entityKey,
        predicate: generated.predicate,
        objectText: `${generated.objectPrefix}-${index}`,
        now: generated.startAt + index,
        origin: 'active',
      });
    }
  }
  return factKeysById;
}

function evaluateSelection(
  fixture: MemoryHybridAblationCase,
  factKeysById: ReadonlyMap<string, string>,
  selectedFactIds: ReadonlyArray<string>,
): CaseResult {
  const selectedKeys = selectedFactIds.map((id) => factKeysById.get(id) ?? 'unknown');
  const expected = fixture.expectedFactKey !== null;
  return {
    family: fixture.family,
    expected,
    targetHit: expected ? selectedKeys[0] === fixture.expectedFactKey : false,
    pollution: expected
      ? selectedKeys.some((key) => key !== fixture.expectedFactKey)
      : selectedKeys.length > 0,
    selectedKeys,
  };
}

async function runForegroundCase(
  fixture: MemoryHybridAblationCase,
  strategy: CandidateStrategy,
): Promise<CaseResult> {
  const namespace = namespaceFor(fixture, strategy);
  const factKeysById = seedFixture(fixture, strategy);
  const sourceThreadId = `${namespace}-source`;
  const message: Message = {
    id: `${namespace}-message`,
    role: 'user',
    content: fixture.query,
    timestamp: fixture.now,
  };
  await buildUnifiedMemoryAccessContext({
    messages: [message],
    memoryConversationId: namespace,
    sourceThreadId,
    personaId: 'memory-hybrid-ablation',
    taskId: null,
    mode: 'chat',
    now: fixture.now,
    recallLimit: 1,
    retrievalStrategy: strategy === 'lexical' ? 'lexical_only' : 'production',
  });
  const sourceThreadIdHash = await buildMemoryRetrievalScopeHash('source_thread', sourceThreadId);
  if (!sourceThreadIdHash) throw new Error('Hybrid ablation source-thread hash is unavailable.');
  const event = readRecentMemoryRetrievalEvents({
    sourceThreadIdHash,
    operation: 'prompt_assembly',
    limit: 1,
  })[0];
  if (!event || event.candidates.strategy !== strategy) {
    throw new Error('Hybrid ablation did not traverse the configured foreground strategy.');
  }
  return evaluateSelection(fixture, factKeysById, event.counts.selectedFactIds);
}

async function runAblationOnEmptyDatabase(): Promise<MemoryHybridAblationReport> {
  const pairs: Array<{
    fixture: MemoryHybridAblationCase;
    lexical: CaseResult;
    hybrid: CaseResult;
  }> = [];
  for (const fixture of MEMORY_HYBRID_ABLATION_CASES) {
    const lexical = await runForegroundCase(fixture, 'lexical');
    const hybrid = await runForegroundCase(fixture, 'hybrid');
    pairs.push({ fixture, lexical, hybrid });
  }
  const controls = pairs.filter(({ fixture }) => fixture.family === 'lexical_control');
  const productPositives = pairs.filter(
    ({ fixture }) =>
      fixture.family !== 'lexical_control' && fixture.family !== 'eligibility_negative',
  );
  const negatives = pairs.filter(({ fixture }) => fixture.family === 'eligibility_negative');
  const productLexicalRecallAtOne = rate(
    productPositives.filter(({ lexical }) => lexical.targetHit).length,
    productPositives.length,
  );
  const productHybridRecallAtOne = rate(
    productPositives.filter(({ hybrid }) => hybrid.targetHit).length,
    productPositives.length,
  );
  const family = (name: 'entity' | 'temporal' | 'local_similarity') => {
    const entries = pairs.filter(({ fixture }) => fixture.family === name);
    return {
      caseCount: entries.length,
      lexicalTargetHitCount: entries.filter(({ lexical }) => lexical.targetHit).length,
      hybridTargetHitCount: entries.filter(({ hybrid }) => hybrid.targetHit).length,
    };
  };
  const hybridRecallGain = productHybridRecallAtOne - productLexicalRecallAtOne;
  return {
    schemaVersion: 'memory-hybrid-ablation-report-v2',
    fixtureVersion: MEMORY_HYBRID_ABLATION_FIXTURE_VERSION,
    fixtureSignature: MEMORY_HYBRID_ABLATION_FIXTURE_SIGNATURE,
    claimClass: 'diagnostic_only',
    downstreamAnswerEvaluated: false,
    executionPath: 'foreground_product',
    caseCount: pairs.length,
    lexicalControl: {
      caseCount: controls.length,
      identicalSelectionCount: controls.filter(
        ({ lexical, hybrid }) =>
          stableStringify(lexical.selectedKeys) === stableStringify(hybrid.selectedKeys),
      ).length,
      lexicalRecallAtOne: rate(
        controls.filter(({ lexical }) => lexical.targetHit).length,
        controls.length,
      ),
      hybridRecallAtOne: rate(
        controls.filter(({ hybrid }) => hybrid.targetHit).length,
        controls.length,
      ),
    },
    productRetrieval: {
      caseCount: productPositives.length,
      lexicalRecallAtOne: productLexicalRecallAtOne,
      hybridRecallAtOne: productHybridRecallAtOne,
      hybridRecallGain,
    },
    diagnosticTarget: {
      minimumHybridRecallGain: 0.2,
      met: hybridRecallGain >= 0.2,
      releaseGate: false,
    },
    pollution: {
      lexicalCaseCount: pairs.filter(({ lexical }) => lexical.pollution).length,
      hybridCaseCount: pairs.filter(({ hybrid }) => hybrid.pollution).length,
      hybridOnlyRegressionCount: pairs.filter(
        ({ lexical, hybrid }) => hybrid.pollution && !lexical.pollution,
      ).length,
      lexicalNegativeFalsePositiveCount: negatives.filter(({ lexical }) => lexical.pollution)
        .length,
      hybridNegativeFalsePositiveCount: negatives.filter(({ hybrid }) => hybrid.pollution).length,
    },
    families: {
      entity: family('entity'),
      temporal: family('temporal'),
      local_similarity: family('local_similarity'),
    },
  };
}

export async function runMemoryHybridAblation(): Promise<MemoryHybridAblationReport> {
  assertFrozenFixtureSignature();
  return runInIsolatedStructuredMemoryEvaluation(runAblationOnEmptyDatabase);
}
