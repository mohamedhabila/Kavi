import type { MemoryFactScope } from './facts/types';
import type { MemoryWithdrawalReceipt } from './withdrawalTypes';

export interface SerializedMemoryFact {
  id: string;
  subject: string;
  subjectId: string;
  predicate: string;
  value: string;
  confidence: number;
  pinned: boolean;
  validAt: number;
  invalidAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  scope: MemoryFactScope;
  personaId: string | null;
  originConversationId: string | null;
  originThreadId: string | null;
  originTaskId: string | null;
  sourceMessageId: string | null;
  sourceTurnId: string | null;
  sourceSummary: string | null;
  importance: number;
  accessCount: number;
  lastRecalledAt: number | null;
  lastAccessedAt: number | null;
  decayPolicy: string;
}

export interface MemoryRememberResult {
  ok: true;
  fact: SerializedMemoryFact;
  status: 'created' | 'duplicate';
  superseded: MemorySupersessionReceipt[];
}

export interface MemorySupersessionReceipt {
  id: string;
  invalidAt: number;
}

export interface MemoryPinResult {
  ok: true;
  status: 'pinned' | 'unpinned';
  fact: SerializedMemoryFact;
}

export interface MemoryForgetResult {
  ok: true;
  action: 'withdrawal';
  status: 'withdrawn' | 'already_withdrawn';
  factId: string;
  receipt: MemoryWithdrawalReceipt;
}

export interface MemoryInvalidateResult {
  ok: true;
  action: 'invalidation';
  factId: string;
  invalidatedAt: number;
  status: 'invalidated';
}
