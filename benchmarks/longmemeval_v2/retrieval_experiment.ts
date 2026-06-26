import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

import { embedText } from './runtimeSimpleEmbeddingsStub';

type JsonObject = Record<string, unknown>;

interface Args {
  db: string;
  query: string;
  out: string;
  limit: number;
}

interface FactRow {
  id: string;
  subject_id: string;
  predicate: string;
  object_text: string;
  source_summary: string | null;
  source_run_id: string | null;
  memory_kind: string;
  scope: string;
  origin_conversation_id: string | null;
  updated_at: number;
  importance: number;
  confidence: number;
  embedding: string | null;
}

interface RankedDbFact {
  fact: FactRow;
  textScore: number;
  vectorScore: number;
  score: number;
}

function parseArgs(argv: string[]): Args {
  const parsed: Partial<Args> = { limit: 12 };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') {
      parsed.db = argv[++index];
    } else if (arg === '--query') {
      parsed.query = argv[++index];
    } else if (arg === '--out') {
      parsed.out = argv[++index];
    } else if (arg === '--limit') {
      parsed.limit = Number(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!parsed.db) throw new Error('--db is required');
  if (!parsed.query) throw new Error('--query is required');
  if (!parsed.out) throw new Error('--out is required');
  return parsed as Args;
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function textForFact(fact: FactRow): string {
  return `${fact.subject_id} ${fact.predicate} ${fact.object_text} ${fact.source_summary ?? ''}`;
}

function units(value: string): Set<string> {
  const chars = Array.from(value.normalize('NFKC').toLocaleLowerCase()).filter((char) =>
    /[\p{L}\p{M}\p{N}]/u.test(char),
  );
  const out = new Set<string>();
  for (const width of [2, 3, 4]) {
    if (chars.length < width) continue;
    for (let index = 0; index <= chars.length - width; index += 1) {
      out.add(`${width}:${chars.slice(index, index + width).join('')}`);
    }
  }
  return out;
}

function overlap(queryUnits: Set<string>, candidate: string): number {
  if (queryUnits.size === 0) return 0;
  const candidateUnits = units(candidate);
  let hits = 0;
  for (const unit of queryUnits) {
    if (candidateUnits.has(unit)) hits += 1;
  }
  return hits / queryUnits.size;
}

function sourceRunSummary(rows: RankedDbFact[], limit: number): JsonObject[] {
  const counts = new Map<string, { count: number; bestScore: number; bestSnippet: string }>();
  for (const row of rows.slice(0, limit)) {
    const key = row.fact.source_run_id ?? '(none)';
    const existing = counts.get(key);
    if (!existing || row.score > existing.bestScore) {
      counts.set(key, {
        count: (existing?.count ?? 0) + 1,
        bestScore: row.score,
        bestSnippet: row.fact.object_text.slice(0, 220),
      });
    } else {
      existing.count += 1;
    }
  }
  return Array.from(counts.entries()).map(([sourceRunId, value]) => ({
    sourceRunId,
    ...value,
  }));
}

function appSourceRunSummary(rows: Array<{ fact: { sourceRunId?: string | null; objectText: string }; score: number }>): JsonObject[] {
  const counts = new Map<string, { count: number; bestScore: number; bestSnippet: string }>();
  for (const row of rows) {
    const key = row.fact.sourceRunId ?? '(none)';
    const existing = counts.get(key);
    if (!existing || row.score > existing.bestScore) {
      counts.set(key, {
        count: (existing?.count ?? 0) + 1,
        bestScore: row.score,
        bestSnippet: row.fact.objectText.slice(0, 220),
      });
    } else {
      existing.count += 1;
    }
  }
  return Array.from(counts.entries()).map(([sourceRunId, value]) => ({
    sourceRunId,
    ...value,
  }));
}

function rankDbFacts(
  facts: FactRow[],
  query: string,
  weights: { text: number; vector: number },
): RankedDbFact[] {
  const queryUnits = units(query);
  const queryVector = embedText(query);
  return facts
    .map((fact) => {
      const text = textForFact(fact);
      const textScore = overlap(queryUnits, text);
      const vectorScore = Math.max(0, cosine(queryVector, embedText(text)));
      return {
        fact,
        textScore,
        vectorScore,
        score:
          weights.text * textScore +
          weights.vector * vectorScore +
          fact.importance * 0.01 +
          fact.confidence * 0.001,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.fact.updated_at - left.fact.updated_at;
    });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const sourceDb = resolve(args.db);
  const out = resolve(args.out);
  const outDir = resolve(out, '..');
  const workDir = join(outDir, `${basename(out, '.json')}-db`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  copyFileSync(sourceDb, join(workDir, 'kavi-memory.db'));
  process.env.KAVI_MEMORY_SQLITE_DIR = workDir;

  const { ensureFactSchema, resetFactSchemaCacheForTests } = await import(
    '../../src/services/memory/schema'
  );
  const { closeMemoryDb } = await import('../../src/services/memory/sqlite-store');
  const { recallScoredFactsForQuery, backfillFactEmbeddings } = await import(
    '../../src/services/memory/factRecall'
  );
  const { buildUnifiedMemoryAccessContext } = await import(
    '../../src/services/memory/memoryAccessGateway'
  );
  resetFactSchemaCacheForTests();
  ensureFactSchema();

  const db = new Database(join(workDir, 'kavi-memory.db'));
  const conversationRow = db
    .prepare(
      `SELECT origin_conversation_id AS id
         FROM memory_facts
        WHERE origin_conversation_id IS NOT NULL
        LIMIT 1`,
    )
    .get() as { id?: unknown } | undefined;
  const conversationId = typeof conversationRow?.id === 'string' ? conversationRow.id : null;
  if (typeof conversationId !== 'string' || !conversationId) {
    throw new Error('Could not infer conversation id from memory_facts');
  }

  const allFacts = db
    .prepare(
      `SELECT id, subject_id, predicate, object_text, source_summary, source_run_id,
              memory_kind, scope, origin_conversation_id, updated_at, importance, confidence, embedding
         FROM memory_facts
        WHERE deleted_at IS NULL
          AND invalid_at IS NULL
        ORDER BY updated_at DESC`,
    )
    .all() as FactRow[];
  const topCandidatePool = db
    .prepare(
      `SELECT source_run_id, COUNT(*) AS count
         FROM (
           SELECT source_run_id
             FROM memory_facts
            WHERE deleted_at IS NULL
              AND invalid_at IS NULL
            ORDER BY pinned DESC, importance DESC, updated_at DESC
            LIMIT 500
         )
        GROUP BY source_run_id
        ORDER BY count DESC
        LIMIT 12`,
    )
    .all();

  const appCurrent = await recallScoredFactsForQuery(args.query, {
    limit: args.limit,
    conversationId,
  });
  const appTextRelevanceOnly = await recallScoredFactsForQuery(args.query, {
    limit: args.limit,
    conversationId,
    vectorWeight: 0,
    textWeight: 1,
    threshold: 0,
  });
  const now = Date.now();
  const buildBridgeDiagnostic = () =>
    buildUnifiedMemoryAccessContext({
      messages: [
        {
          id: `diagnostic-query-${now}`,
          role: 'user',
          content: args.query,
          timestamp: now,
        },
      ],
      conversationId,
      mode: 'agentic',
      recallLimit: args.limit,
      goals: [
        {
          id: `diagnostic-question-${now}`,
          title: args.query,
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: now,
          updatedAt: now,
          completionPolicy: 'persistent',
        },
      ],
      now,
    });
  const appBridgeBeforeBackfill = await buildBridgeDiagnostic();
  const embeddedCount = await backfillFactEmbeddings(
    { provider: 'local', model: 'unicode-char-ngram-v1' },
    { maxFacts: 3_000 },
  );
  const appLocalEmbedding = await recallScoredFactsForQuery(args.query, {
    limit: args.limit,
    conversationId,
    embeddingConfig: { provider: 'local', model: 'unicode-char-ngram-v1' },
    vectorWeight: 0.7,
    textWeight: 0.3,
    threshold: 0,
  });
  const appBridgeAfterBackfill = await buildBridgeDiagnostic();

  const dbAllLexical = rankDbFacts(allFacts, args.query, { text: 1, vector: 0 });
  const dbAllSimpleEmbedding = rankDbFacts(allFacts, args.query, { text: 0.3, vector: 0.7 });

  const payload = {
    sourceDb,
    workDir,
    conversationId,
    factCount: allFacts.length,
    query: args.query,
    candidatePoolTop500: topCandidatePool,
    appCurrent: {
      selected: appCurrent.map((entry) => ({
        factId: entry.fact.id,
        sourceRunId: entry.fact.sourceRunId,
        memoryKind: entry.fact.memoryKind,
        score: entry.score,
        relevanceScore: entry.relevanceScore,
        textScore: entry.textScore,
        vectorScore: entry.vectorScore,
        scopeBoost: entry.scopeBoost,
        reinforcementBoost: entry.reinforcementBoost,
        objectText: entry.fact.objectText.slice(0, 260),
      })),
      sourceRuns: appSourceRunSummary(appCurrent),
    },
    appTextRelevanceOnly: {
      selected: appTextRelevanceOnly.map((entry) => ({
        factId: entry.fact.id,
        sourceRunId: entry.fact.sourceRunId,
        memoryKind: entry.fact.memoryKind,
        score: entry.score,
        relevanceScore: entry.relevanceScore,
        textScore: entry.textScore,
        vectorScore: entry.vectorScore,
        scopeBoost: entry.scopeBoost,
        objectText: entry.fact.objectText.slice(0, 260),
      })),
      sourceRuns: appSourceRunSummary(appTextRelevanceOnly),
    },
    appLocalEmbedding: {
      embeddedCount,
      selected: appLocalEmbedding.map((entry) => ({
        factId: entry.fact.id,
        sourceRunId: entry.fact.sourceRunId,
        memoryKind: entry.fact.memoryKind,
        score: entry.score,
        relevanceScore: entry.relevanceScore,
        textScore: entry.textScore,
        vectorScore: entry.vectorScore,
        scopeBoost: entry.scopeBoost,
        objectText: entry.fact.objectText.slice(0, 260),
      })),
      sourceRuns: appSourceRunSummary(appLocalEmbedding),
    },
    appBridgeBeforeBackfill: {
      recalledFactCount: appBridgeBeforeBackfill.livingMemory?.recalledFactCount ?? 0,
      recalledEpisodeCount: appBridgeBeforeBackfill.livingMemory?.recalledEpisodeCount ?? 0,
      sections: (appBridgeBeforeBackfill.livingMemory?.sections ?? []).map((section, index) => ({
        index,
        text: section.text.slice(0, 1000),
      })),
      flattened: (appBridgeBeforeBackfill.livingMemory?.sections ?? [])
        .map((section) => section.text)
        .join('\n\n')
        .slice(0, 2000),
    },
    appBridgeAfterBackfill: {
      recalledFactCount: appBridgeAfterBackfill.livingMemory?.recalledFactCount ?? 0,
      recalledEpisodeCount: appBridgeAfterBackfill.livingMemory?.recalledEpisodeCount ?? 0,
      sections: (appBridgeAfterBackfill.livingMemory?.sections ?? []).map((section, index) => ({
        index,
        text: section.text.slice(0, 1000),
      })),
      flattened: (appBridgeAfterBackfill.livingMemory?.sections ?? [])
        .map((section) => section.text)
        .join('\n\n')
        .slice(0, 2000),
    },
    dbAllLexical: {
      sourceRuns: sourceRunSummary(dbAllLexical, args.limit),
      topFacts: dbAllLexical.slice(0, args.limit).map((entry) => ({
        factId: entry.fact.id,
        sourceRunId: entry.fact.source_run_id,
        memoryKind: entry.fact.memory_kind,
        score: entry.score,
        textScore: entry.textScore,
        vectorScore: entry.vectorScore,
        objectText: entry.fact.object_text.slice(0, 260),
      })),
    },
    dbAllSimpleEmbedding: {
      sourceRuns: sourceRunSummary(dbAllSimpleEmbedding, args.limit),
      topFacts: dbAllSimpleEmbedding.slice(0, args.limit).map((entry) => ({
        factId: entry.fact.id,
        sourceRunId: entry.fact.source_run_id,
        memoryKind: entry.fact.memory_kind,
        score: entry.score,
        textScore: entry.textScore,
        vectorScore: entry.vectorScore,
        objectText: entry.fact.object_text.slice(0, 260),
      })),
    },
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  closeMemoryDb();
  db.close();
  process.stdout.write(`${JSON.stringify({ out, factCount: allFacts.length, conversationId })}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
