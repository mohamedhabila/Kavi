import { ensureFactSchema } from '../schema';
import { getMemoryDb } from '../database';

export type MemoryDatabase = ReturnType<typeof getMemoryDb>;

export function getSchemaReadyMemoryDb(): MemoryDatabase {
  ensureFactSchema();
  return getMemoryDb();
}
