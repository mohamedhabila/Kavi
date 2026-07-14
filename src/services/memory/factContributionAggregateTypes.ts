import type { MemoryFactContributionChildCommitment } from './factContributionChildCommitments';
import type {
  MemoryFactContributionPayloadV1,
  MemoryFactContributionProducerIdentity,
  MemoryFactContributionSourceAlias,
  MemoryFactContributionSourceScope,
} from './factContributionCodec';
import type { FactContributionSupersessionPlan } from './factContributionSupersessionStore';
import type { MemoryFactReviewState, MemoryFactSensitivity } from './facts/applicabilityProvenance';
import type {
  FactContributionClassifierContext,
  FactContributionExplicitProjection,
} from './facts/factContributionProjection';
import type { MemoryFactKind, MemoryFactScope } from './facts/types';

export interface NormalizedContributionParent {
  id: string;
  factId: string;
  memoryOwnerId: string;
  scope: MemoryFactContributionSourceScope;
  producer: MemoryFactContributionProducerIdentity;
  sourceCommitment: MemoryFactContributionChildCommitment;
  supersessionCommitment: MemoryFactContributionChildCommitment;
  payload: MemoryFactContributionPayloadV1;
  payloadByteLength: number;
  contributedAt: number;
}

export interface FactContributionFactEvidence {
  id: string;
  memoryOwnerId: string;
  memoryKind: MemoryFactKind;
  scope: MemoryFactScope;
  originConversationId: string | null;
  originThreadId: string | null;
  originTaskId: string | null;
  personaId: string | null;
  subjectId: string;
  predicate: string;
  objectText: string;
  objectEntityId: string | null;
  createdAt: number;
  invalidAt: number | null;
  deletedAt: number | null;
  pinned: boolean;
  reviewState: MemoryFactReviewState;
  sensitivity: MemoryFactSensitivity;
  sensitivityPolicyVersion: number;
}

export interface FactContributionPredecessorEvidence {
  id: string;
  memoryOwnerId: string;
  subjectId: string;
  predicate: string;
  scope: MemoryFactScope;
  personaId: string | null;
  originConversationId: string | null;
  originThreadId: string | null;
  originTaskId: string | null;
  invalidAt: number | null;
  deletedAt: number | null;
}

export interface VerifiedFactContributionAggregate {
  contributionId: string;
  factId: string;
  memoryOwnerId: string;
  sourceScope: Readonly<MemoryFactContributionSourceScope>;
  producer: Readonly<MemoryFactContributionProducerIdentity>;
  contributedAt: number;
  payload: MemoryFactContributionPayloadV1;
  sourceAliases: ReadonlyArray<Readonly<MemoryFactContributionSourceAlias>>;
  supersessionPlan: FactContributionSupersessionPlan;
  factEvidence: Readonly<FactContributionFactEvidence>;
  classifierContext: Readonly<FactContributionClassifierContext>;
  explicitProjection: Readonly<FactContributionExplicitProjection> | null;
}

export interface VerifiedFactContributionLoadResult {
  aggregates: ReadonlyArray<Readonly<VerifiedFactContributionAggregate>>;
  missingContributionIds: ReadonlyArray<string>;
}
