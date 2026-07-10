import type { Message } from '../types/message';
import { upsertEntity } from '../services/memory/entities';
import { recordFact, setFactEmbedding } from '../services/memory/facts/mutations';
import { recallScoredFactsForQuery } from '../services/memory/factRecall';
import { buildUnifiedMemoryAccessContext } from '../services/memory/memoryAccessGateway';
import {
  buildMemoryRetrievalScopeHash,
  readRecentMemoryRetrievalEvents,
} from '../services/memory/retrievalLog';
import { clearStructuredMemory } from '../services/memory/schema';
import { getMemoryDb } from '../services/memory/sqlite-store';
import { stableHash, stableStringify } from './e2eAgent/e2eTraceRedaction';
import {
  MEMORY_HYBRID_ABLATION_CASES,
  MEMORY_HYBRID_ABLATION_FIXTURE_SIGNATURE,
  MEMORY_HYBRID_ABLATION_FIXTURE_VERSION,
  type MemoryHybridAblationCase,
  type MemoryHybridAblationFamily,
  type MemoryHybridAblationPath,
} from './memoryHybridAblationFixtures';

type CandidateStrategy = 'lexical' | 'hybrid';

type CaseResult = Readonly<{
  family: MemoryHybridAblationFamily;
  path: MemoryHybridAblationPath;
  expected: boolean;
  targetHit: boolean;
  pollution: boolean;
  selectedKeys: ReadonlyArray<string>;
}>;

export type MemoryHybridAblationReport = Readonly<{
  schemaVersion: 'memory-hybrid-ablation-report-v1';
  fixtureVersion: typeof MEMORY_HYBRID_ABLATION_FIXTURE_VERSION;
  fixtureSignature: typeof MEMORY_HYBRID_ABLATION_FIXTURE_SIGNATURE;
  claimClass: 'diagnostic_only';
  downstreamAnswerEvaluated: false;
  caseCount: number;
  foregroundPromptVisibleCaseCount: number;
  componentOnlyCaseCount: number;
  lexicalControl: Readonly<{
    caseCount: number;
    identicalSelectionCount: number;
    lexicalRecallAtOne: number;
    hybridRecallAtOne: number;
  }>;
  foregroundPositiveRetrieval: Readonly<{
    caseCount: number;
    lexicalRecallAtOne: number;
    hybridRecallAtOne: number;
    hybridRecallGain: number;
  }>;
  componentOnly: Readonly<{
    caseCount: number;
    lexicalRecallAtOne: number;
    hybridRecallAtOne: number;
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
      'entity' | 'temporal' | 'local_semantic',
      Readonly<{
        evidenceClass: 'foreground_prompt_visible' | 'component_only';
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

const STRUCTURED_MEMORY_TABLES = [
  'memory_fact_observations',
  'memory_fact_evidence',
  'memory_fact_terms',
  'memory_fact_term_stats',
  'memory_episodes',
  'memory_facts',
  'memory_entities',
  'memory_blocks',
  'memory_working_blocks',
  'memory_consolidation_state',
  'memory_migration_state',
  'memory_ingestion_receipts',
  'memory_ingestion_jobs',
  'memory_tasks',
  'memory_reflections',
  'memory_chunks',
  'memory_retrieval_events',
  'memory_withdrawal_sources',
  'memory_withdrawal_facts',
  'memory_withdrawals',
  'memory_episode_access_policies',
] as const;

function assertEmptyEvaluationDatabase(): void {
  const db = getMemoryDb();
  for (const table of STRUCTURED_MEMORY_TABLES) {
    const exists = db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      table,
    );
    if (!exists) continue;
    const count = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count;
    if (count !== 0) {
      throw new Error('Hybrid ablation requires an isolated empty evaluation database.');
    }
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
    const recorded = recordFact({
      subjectId,
      predicate: seed.predicate,
      objectText: seed.objectText,
      scope: 'conversation',
      originConversationId:
        seed.origin === 'active' ? namespace : `${namespace}-other-conversation`,
      supersedePrior: false,
      now: seed.now,
      ...(seed.validAt !== undefined ? { validAt: seed.validAt } : {}),
      ...(seed.expiresAt !== undefined ? { expiresAt: seed.expiresAt } : {}),
    });
    factKeysById.set(recorded.fact.id, seed.key);
    if (seed.embedding) setFactEmbedding(recorded.fact.id, [...seed.embedding], seed.now);
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
    path: fixture.path,
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

async function runLocalSemanticCase(
  fixture: MemoryHybridAblationCase,
  strategy: CandidateStrategy,
): Promise<CaseResult> {
  const namespace = namespaceFor(fixture, strategy);
  const factKeysById = seedFixture(fixture, strategy);
  const scored = await recallScoredFactsForQuery(fixture.query, {
    candidateStrategy: strategy,
    conversationId: namespace,
    limit: 1,
    now: fixture.now,
    ...(fixture.queryEmbedding
      ? { localSemantic: { queryEmbedding: fixture.queryEmbedding } }
      : {}),
  });
  return evaluateSelection(
    fixture,
    factKeysById,
    scored.map((entry) => entry.fact.id),
  );
}

async function runCase(
  fixture: MemoryHybridAblationCase,
  strategy: CandidateStrategy,
): Promise<CaseResult> {
  return fixture.path === 'foreground_prompt_visible'
    ? runForegroundCase(fixture, strategy)
    : runLocalSemanticCase(fixture, strategy);
}

async function runAblationOnEmptyDatabase(): Promise<MemoryHybridAblationReport> {
  const pairs: Array<{
    fixture: MemoryHybridAblationCase;
    lexical: CaseResult;
    hybrid: CaseResult;
  }> = [];
  for (const fixture of MEMORY_HYBRID_ABLATION_CASES) {
    const lexical = await runCase(fixture, 'lexical');
    const hybrid = await runCase(fixture, 'hybrid');
    pairs.push({ fixture, lexical, hybrid });
  }
  const controls = pairs.filter(({ fixture }) => fixture.family === 'lexical_control');
  const foregroundPositives = pairs.filter(({ fixture }) =>
    ['entity', 'temporal'].includes(fixture.family),
  );
  const componentOnly = pairs.filter(({ fixture }) => fixture.family === 'local_semantic');
  const negatives = pairs.filter(({ fixture }) => fixture.family === 'eligibility_negative');
  const foregroundLexicalRecallAtOne = rate(
    foregroundPositives.filter(({ lexical }) => lexical.targetHit).length,
    foregroundPositives.length,
  );
  const foregroundHybridRecallAtOne = rate(
    foregroundPositives.filter(({ hybrid }) => hybrid.targetHit).length,
    foregroundPositives.length,
  );
  const family = (name: 'entity' | 'temporal' | 'local_semantic') => {
    const entries = pairs.filter(({ fixture }) => fixture.family === name);
    return {
      evidenceClass:
        name === 'local_semantic'
          ? ('component_only' as const)
          : ('foreground_prompt_visible' as const),
      caseCount: entries.length,
      lexicalTargetHitCount: entries.filter(({ lexical }) => lexical.targetHit).length,
      hybridTargetHitCount: entries.filter(({ hybrid }) => hybrid.targetHit).length,
    };
  };
  const hybridRecallGain = foregroundHybridRecallAtOne - foregroundLexicalRecallAtOne;
  return {
    schemaVersion: 'memory-hybrid-ablation-report-v1',
    fixtureVersion: MEMORY_HYBRID_ABLATION_FIXTURE_VERSION,
    fixtureSignature: MEMORY_HYBRID_ABLATION_FIXTURE_SIGNATURE,
    claimClass: 'diagnostic_only',
    downstreamAnswerEvaluated: false,
    caseCount: pairs.length,
    foregroundPromptVisibleCaseCount: pairs.filter(
      ({ fixture }) => fixture.path === 'foreground_prompt_visible',
    ).length,
    componentOnlyCaseCount: pairs.filter(({ fixture }) => fixture.path === 'component_only').length,
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
    foregroundPositiveRetrieval: {
      caseCount: foregroundPositives.length,
      lexicalRecallAtOne: foregroundLexicalRecallAtOne,
      hybridRecallAtOne: foregroundHybridRecallAtOne,
      hybridRecallGain,
    },
    componentOnly: {
      caseCount: componentOnly.length,
      lexicalRecallAtOne: rate(
        componentOnly.filter(({ lexical }) => lexical.targetHit).length,
        componentOnly.length,
      ),
      hybridRecallAtOne: rate(
        componentOnly.filter(({ hybrid }) => hybrid.targetHit).length,
        componentOnly.length,
      ),
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
      lexicalNegativeFalsePositiveCount: negatives.filter(({ lexical }) => lexical.pollution).length,
      hybridNegativeFalsePositiveCount: negatives.filter(({ hybrid }) => hybrid.pollution).length,
    },
    families: {
      entity: family('entity'),
      temporal: family('temporal'),
      local_semantic: family('local_semantic'),
    },
  };
}

export async function runMemoryHybridAblation(): Promise<MemoryHybridAblationReport> {
  assertFrozenFixtureSignature();
  assertEmptyEvaluationDatabase();
  try {
    return await runAblationOnEmptyDatabase();
  } finally {
    clearStructuredMemory();
  }
}
