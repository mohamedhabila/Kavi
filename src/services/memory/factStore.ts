// ---------------------------------------------------------------------------
// Kavi — Memory primitives barrel
// ---------------------------------------------------------------------------
// Re-exports the focused single-responsibility modules:
//   • schema.ts   — table bootstrap + shared internal helpers
//   • entities.ts — canonical entity registry
//   • facts.ts    — bi-temporal fact store
//   • blocks.ts   — Letta-style memory blocks
// Prefer importing from the focused modules in new code; this barrel is kept
// for convenience and existing call sites.
// ---------------------------------------------------------------------------

export { ensureFactSchema, resetFactSchemaCacheForTests } from './schema';
export {
  type EntityType,
  type MemoryEntity,
  type UpsertEntityInput,
  upsertEntity,
  getEntityById,
  findEntityByName,
  softDeleteEntity,
} from './entities';
export {
  type MemoryFact,
  type MemoryFactScope,
  type MemoryDecayPolicy,
  type RecordFactInput,
  type RecordFactResult,
  type ListFactsOptions,
  recordFact,
  listFacts,
  getFactById,
  invalidateFact,
  softDeleteFact,
  setFactPinned,
  setFactEmbedding,
  markFactsRecalled,
  normalizeScope,
} from './facts';
export {
  type MemoryBlock,
  type BlockEditOptions,
  DEFAULT_MEMORY_BLOCKS,
  BlockOverflowError,
  ensureDefaultBlocks,
  getBlock,
  listBlocks,
  editBlock,
  upsertBlock,
  clearBlock,
} from './blocks';
export {
  type WorkingBlockLabel,
  type WorkingBlockScope,
  type WorkingMemoryBlock,
  buildWorkingBlockScopeKey,
  getWorkingBlock,
  listRecentWorkingBlocks,
  editWorkingBlock,
  clearWorkingBlock,
} from './workingBlocks';
