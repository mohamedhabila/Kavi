import type {
  MemoryAccessScopeIdentity,
  RequiredMemoryAccessScopeIdentity,
} from '../memoryScopeIdentity';
import type { MemoryEpisode } from './types';

export const EPISODE_SHAREABILITY = ['thread_only', 'session_threads'] as const;
export type EpisodeShareability = (typeof EPISODE_SHAREABILITY)[number];

export const EPISODE_SENSITIVITY = ['normal', 'private', 'sensitive'] as const;
export type EpisodeSensitivity = (typeof EPISODE_SENSITIVITY)[number];

export function closedEpisodeSensitivity(value: unknown): EpisodeSensitivity | null {
  return typeof value === 'string' && EPISODE_SENSITIVITY.includes(value as EpisodeSensitivity)
    ? (value as EpisodeSensitivity)
    : null;
}

export interface EpisodeAccessPolicyInput extends MemoryAccessScopeIdentity {
  episodeId: string;
  shareability: EpisodeShareability;
  expiresAt?: number | null;
  boundAt?: number;
}

export interface EpisodeAccessPolicy {
  episodeId: string;
  scope: RequiredMemoryAccessScopeIdentity;
  shareability: EpisodeShareability;
  sensitivity: EpisodeSensitivity;
  expiresAt: number | null;
  policyVersion: 1;
  boundAt: number;
}

export interface EpisodeAccessPolicyRow {
  episode_id: string;
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  persona_id: string;
  task_id: string | null;
  shareability: string;
  sensitivity: string;
  expires_at: number | null;
  policy_version: number;
  bound_at: number;
}

export const CROSS_THREAD_EPISODE_ACCESS_REASONS = [
  'eligible',
  'invalid_context',
  'invalid_policy',
  'origin_mismatch',
  'current_thread',
  'owner_mismatch',
  'session_mismatch',
  'persona_mismatch',
  'thread_only',
  'task_local',
  'private_or_sensitive',
  'deleted',
  'expired',
  'policy_not_yet_bound',
  'not_yet_complete',
  'malformed_source',
  'withdrawn',
] as const;
export type CrossThreadEpisodeAccessReason = (typeof CROSS_THREAD_EPISODE_ACCESS_REASONS)[number];

export type CrossThreadEpisodeAccessDecision =
  | { authorized: true; reason: 'eligible'; policy: EpisodeAccessPolicy }
  | { authorized: false; reason: Exclude<CrossThreadEpisodeAccessReason, 'eligible'> };

export type AutomaticPromptEpisodeAccessDecision =
  | {
      authorized: true;
      reason: 'eligible';
      lane: 'current_thread' | 'cross_thread';
      policy: EpisodeAccessPolicy;
    }
  | { authorized: false; reason: Exclude<CrossThreadEpisodeAccessReason, 'eligible'> };

export interface AuthorizedEpisodeOrigin extends RequiredMemoryAccessScopeIdentity {
  policyVersion: 1;
}

export interface AuthorizedCurrentThreadEpisodeSelection {
  episode: MemoryEpisode;
  lane: 'current_thread';
  authorizedOrigin: AuthorizedEpisodeOrigin;
  /** Exact expiry of the access policy that authorized this prompt projection. */
  policyExpiresAt: number | null;
  accessDecision: Readonly<{ authorized: true; reason: 'eligible' }>;
  relevanceScore: number;
}

export interface AuthorizedCrossThreadEpisodeSelection {
  episode: MemoryEpisode;
  lane: 'cross_thread';
  authorizedOrigin: AuthorizedEpisodeOrigin & { taskId: null };
  /** Exact expiry of the access policy that authorized this prompt projection. */
  policyExpiresAt: number | null;
  accessDecision: Readonly<{ authorized: true; reason: 'eligible' }>;
  relevanceScore: number;
}

export type AuthorizedEpisodeSelection =
  | AuthorizedCurrentThreadEpisodeSelection
  | AuthorizedCrossThreadEpisodeSelection;

export type EpisodeRecallSelection = AuthorizedEpisodeSelection;

export interface CrossThreadEpisodeReasonCount {
  reason: CrossThreadEpisodeAccessReason;
  count: number;
}

/** Counts and closed reason codes only. Safe for local diagnostics. */
export interface CrossThreadEpisodeRecallDiagnostics {
  queryUnitCount: number;
  emptyQuerySuppressed: boolean;
  scannedCount: number;
  eligibleCount: number;
  relevanceRejectedCount: number;
  selectedCount: number;
  threadFanoutDroppedCount: number;
  selectionLimitDroppedCount: number;
  promptBudgetDroppedCount: number;
  fetchMs: number;
  policyMs: number;
  scoreMs: number;
  sortMs: number;
  selectionMs: number;
  totalMs: number;
  reasonCounts: ReadonlyArray<CrossThreadEpisodeReasonCount>;
}
