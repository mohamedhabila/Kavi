import { getSchemaReadyMemoryDb } from './schemaGuard';

export type MemorySqlParam = string | number | null;

export function getOne<Row>(query: string, ...params: MemorySqlParam[]): Row | null {
  return getSchemaReadyMemoryDb().getFirstSync<Row>(query, ...params) ?? null;
}

export function getMany<Row>(query: string, ...params: MemorySqlParam[]): Row[] {
  return getSchemaReadyMemoryDb().getAllSync<Row>(query, ...params);
}

export function runMemoryStatement(
  query: string,
  ...params: MemorySqlParam[]
): { changes?: number } {
  return getSchemaReadyMemoryDb().runSync(query, ...params);
}

export function countRows(query: string, ...params: MemorySqlParam[]): number {
  return Math.max(0, getOne<{ count: number }>(query, ...params)?.count ?? 0);
}
