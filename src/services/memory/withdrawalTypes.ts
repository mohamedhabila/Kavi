export const MEMORY_WITHDRAWAL_STATUSES = ['withdrawn', 'already_withdrawn'] as const;
export type MemoryWithdrawalStatus = (typeof MEMORY_WITHDRAWAL_STATUSES)[number];

export type MemoryWithdrawalCounts = Readonly<{
  facts: number;
  graphRelations: number;
  retrievalTerms: number;
  factEvidence: number;
  factObservations: number;
  episodeAccessPolicies: number;
  episodes: number;
  chunks: number;
  reflections: number;
  workingBlocks: number;
  orphanEntities: number;
  ingestionJobs: number;
  ingestionReceipts: number;
  retrievalEvents: number;
  embeddingCacheEntries: number;
}>;

export type MemoryWithdrawalReceipt = Readonly<{
  status: MemoryWithdrawalStatus;
  withdrawalId: string;
  factId: string;
  withdrawnAt: number;
  counts: MemoryWithdrawalCounts;
}>;

export type WithdrawMemoryFactResult =
  | { status: 'withdrawn'; receipt: MemoryWithdrawalReceipt }
  | { status: 'already_withdrawn'; receipt: MemoryWithdrawalReceipt }
  | { status: 'not_found' };

export const EMPTY_MEMORY_WITHDRAWAL_COUNTS: MemoryWithdrawalCounts = {
  facts: 0,
  graphRelations: 0,
  retrievalTerms: 0,
  factEvidence: 0,
  factObservations: 0,
  episodeAccessPolicies: 0,
  episodes: 0,
  chunks: 0,
  reflections: 0,
  workingBlocks: 0,
  orphanEntities: 0,
  ingestionJobs: 0,
  ingestionReceipts: 0,
  retrievalEvents: 0,
  embeddingCacheEntries: 0,
};
