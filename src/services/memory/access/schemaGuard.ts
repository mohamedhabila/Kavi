import { ensureFactSchema } from '../schema';
import { getMemoryDb } from '../sqlite-store';

export type MemoryDatabase = ReturnType<typeof getMemoryDb>;

export function getSchemaReadyMemoryDb(): MemoryDatabase {
  ensureFactSchema();
  return getMemoryDb();
}
