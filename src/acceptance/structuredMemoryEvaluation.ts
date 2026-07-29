import { clearStructuredMemoryDatabase, ensureFactSchema } from '../services/memory/schema';
import { getMemoryDb } from '../services/memory/database';
import {
  CLEARED_STRUCTURED_MEMORY_TABLES,
  PRESERVED_STRUCTURED_MEMORY_TABLES,
} from '../services/memory/structuredMemoryTableRegistry';

export type StructuredMemoryEvaluationDatabase = ReturnType<typeof getMemoryDb>;

let evaluationActive = false;

function assertEmptyEvaluationDatabase(database: StructuredMemoryEvaluationDatabase): void {
  const clearedTables = new Set<string>(CLEARED_STRUCTURED_MEMORY_TABLES);
  const preservedTables = new Set<string>(PRESERVED_STRUCTURED_MEMORY_TABLES);
  const discoveredTables = database.getAllSync<{ name: string }>(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'memory_%'
      ORDER BY name`,
  );
  const unclassifiedTables = discoveredTables
    .map((row) => row.name)
    .filter((table) => !clearedTables.has(table) && !preservedTables.has(table));
  if (unclassifiedTables.length > 0) {
    throw new Error(
      `Structured memory evaluation found unclassified memory tables: ${unclassifiedTables.join(', ')}`,
    );
  }
  for (const table of discoveredTables.map((row) => row.name)) {
    if (!clearedTables.has(table)) continue;
    const count = database.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${table}`,
    )?.count;
    if (count !== 0) {
      throw new Error(
        'Structured memory evaluation requires an isolated empty evaluation database.',
      );
    }
  }
}

export async function runInIsolatedStructuredMemoryEvaluation<T>(
  operation: (database: StructuredMemoryEvaluationDatabase) => T | Promise<T>,
): Promise<T> {
  if (evaluationActive) {
    throw new Error('Structured memory evaluation is already active.');
  }
  evaluationActive = true;
  let database: StructuredMemoryEvaluationDatabase | null = null;
  let cleanupRequired = false;
  try {
    ensureFactSchema();
    database = getMemoryDb();
    assertEmptyEvaluationDatabase(database);
    cleanupRequired = true;
    return await operation(database);
  } finally {
    try {
      if (database && cleanupRequired) clearStructuredMemoryDatabase(database);
    } finally {
      evaluationActive = false;
    }
  }
}
