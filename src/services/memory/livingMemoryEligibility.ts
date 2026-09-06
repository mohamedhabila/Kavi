// ---------------------------------------------------------------------------
// Living Memory eligibility / policy
// ---------------------------------------------------------------------------
// Resolves which recalled facts and episodes are eligible to enter the
// prompt: runs retrieval, applies the applicability policy, and validates any
// receipt-backed procedure candidates. Section assembly (focus block,
// reflection, prompt text) lives in `livingMemoryBridge.ts`, which calls this
// module and turns its eligible output into prompt sections.
// ---------------------------------------------------------------------------

import type { AgentGoal } from '../../engine/goals/types';
import type { AgentRunControlGraphAsyncWorkState } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import { createLogger } from '../../utils/logger';
import {
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
  type MemoryAuthoritySnapshot,
} from './memoryAuthority';
import type {
  RecallCandidateStrategy,
  RecallLocalSimilarityInput,
} from './factRecallCandidateContract';
import {
  orchestrateMemoryRetrieval,
  type RetrievalOrchestratorTimings,
} from './retrievalOrchestrator';
import type { PromptMemoryFact } from './promptAssembly';
import { createLlmMemoryFactSelector } from './llmFactSelector';
import type { PromptAssemblyRetrievalState } from './promptAssemblyRetrievalEvent';
import { applyMemoryApplicabilityPolicy } from './memoryApplicabilityPolicy';
import type {
  MemoryApplicabilitySummary,
  MemoryApplicabilityUseIntent,
  MemoryExternalEvidenceSignal,
} from './memoryApplicabilityTypes';
import { selectMemoryApplicabilityResolutionFactIds } from './memoryApplicabilityPrompt';
import { loadActiveMemoryFactConflictSignals } from './facts/observations';
import type { RequiredMemoryAccessScopeIdentity } from './memoryScopeIdentity';
import { isMemoryReadEpochCurrent } from './policy';
import { revalidateAutomaticPromptEpisodeSelection } from './episodes/automaticPromptAccess';
import {
  isReceiptBackedProcedureLearningFact,
  resolveApplicableReceiptBackedProcedure,
  type ReceiptBackedProcedureRuntime,
} from './receiptBackedProcedureRecall';

const logger = createLogger('memory.livingMemoryBridge');

export interface LivingMemoryEligibilityInput {
  query: string;
  focusBlockText: string;
  goals?: ReadonlyArray<AgentGoal>;
  activeTaskId?: string;
  resolvedTaskId: string | null;
  asyncWork?: AgentRunControlGraphAsyncWorkState;
  retrievalLlm?: {
    provider: LlmProviderConfig;
    model?: string;
  };
  memoryReadEpoch: number;
  memoryAuthoritySnapshot: MemoryAuthoritySnapshot;
  applicabilityScope: RequiredMemoryAccessScopeIdentity;
  memoryUseIntent: MemoryApplicabilityUseIntent;
  recallLimit: number;
  now: number;
  candidateStrategy?: RecallCandidateStrategy;
  localSimilarity?: RecallLocalSimilarityInput;
  disableRecall: boolean;
  externalMemoryEvidence?: ReadonlyArray<MemoryExternalEvidenceSignal>;
  disableExperienceLearningRecall?: boolean;
  receiptBackedProcedureRuntime?: ReceiptBackedProcedureRuntime;
}

export type LivingMemoryEligibilityResult =
  | { aborted: true }
  | {
      aborted: false;
      assemblyVisibleFacts: PromptMemoryFact[];
      recalledEpisodeSelections: Awaited<
        ReturnType<typeof orchestrateMemoryRetrieval>
      >['episodeSelections'];
      recalledEpisodes: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['episodes'];
      applicableProcedureSections: string[];
      applicabilitySummary: MemoryApplicabilitySummary;
      retrievalState: PromptAssemblyRetrievalState;
      retrievalTimings?: RetrievalOrchestratorTimings;
      retrievalMs: number;
      applicabilityPolicyMs: number;
    };

/**
 * Run recall + the applicability/procedure policy for one prompt build and
 * return the exact set of facts and episodes eligible for assembly. Returns
 * `{ aborted: true }` when the memory read epoch or projection snapshot goes
 * stale mid-flight, mirroring the early `EMPTY_OUTPUT` returns this logic
 * used to perform inline in `buildLivingMemorySections`.
 */
export async function resolveLivingMemoryEligibility(
  input: LivingMemoryEligibilityInput,
): Promise<LivingMemoryEligibilityResult> {
  const {
    query,
    focusBlockText,
    goals,
    activeTaskId,
    resolvedTaskId,
    asyncWork,
    retrievalLlm,
    memoryReadEpoch,
    memoryAuthoritySnapshot,
    applicabilityScope,
    memoryUseIntent,
    recallLimit,
    now,
    candidateStrategy,
    localSimilarity,
    disableRecall,
    externalMemoryEvidence,
    disableExperienceLearningRecall,
    receiptBackedProcedureRuntime,
  } = input;

  const isProjectionCurrent = (): boolean =>
    isMemoryProjectionSnapshotCurrent(memoryAuthoritySnapshot) &&
    isMemoryProjectionSnapshotDurablyCurrent(memoryAuthoritySnapshot);

  let recalledFacts: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['facts'] = [];
  let resolutionFacts: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['resolutionFacts'] =
    [];
  let recalledEpisodes: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['episodes'] = [];
  let recalledEpisodeSelections: Awaited<
    ReturnType<typeof orchestrateMemoryRetrieval>
  >['episodeSelections'] = [];
  let retrievalTimings: RetrievalOrchestratorTimings | undefined;
  let retrievalState: PromptAssemblyRetrievalState = disableRecall ? 'disabled' : 'completed';
  let retrievalMs = 0;
  const factSelector = !disableRecall
    ? createLlmMemoryFactSelector(
        retrievalLlm ? { ...retrievalLlm, memoryReadEpoch, memoryAuthoritySnapshot } : undefined,
      )
    : null;
  if (!disableRecall) {
    const retrievalStarted = Date.now();
    try {
      const retrieval = await orchestrateMemoryRetrieval({
        userMessage: query,
        focusText: focusBlockText,
        goals,
        activeTaskId: activeTaskId ?? resolvedTaskId ?? undefined,
        asyncWork,
        ...(factSelector ? { factSelector } : {}),
        memoryScope: applicabilityScope,
        memoryUseIntent,
        limit: recallLimit,
        now,
        ...(candidateStrategy ? { candidateStrategy } : {}),
        ...(localSimilarity ? { localSimilarity } : {}),
        memoryReadEpoch,
      });
      if (!isMemoryReadEpochCurrent(memoryReadEpoch) || !isProjectionCurrent()) {
        return { aborted: true };
      }
      recalledFacts = retrieval.facts;
      resolutionFacts = retrieval.resolutionFacts;
      recalledEpisodeSelections = retrieval.episodeSelections.flatMap((selection) => {
        const authorized = revalidateAutomaticPromptEpisodeSelection({
          currentScope: applicabilityScope,
          selection,
          asOf: now,
        });
        return authorized ? [authorized] : [];
      });
      recalledEpisodes = recalledEpisodeSelections.map((selection) => selection.episode);
      retrievalTimings = retrieval.timings;
    } catch (error) {
      if (!isMemoryReadEpochCurrent(memoryReadEpoch) || !isProjectionCurrent()) {
        return { aborted: true };
      }
      logger.devWarn(
        'livingMemoryBridge.orchestrateMemoryRetrieval failed:',
        error instanceof Error ? error.message : String(error),
      );
      recalledFacts = [];
      resolutionFacts = [];
      recalledEpisodes = [];
      recalledEpisodeSelections = [];
      retrievalState = 'degraded';
    }
    retrievalMs += Date.now() - retrievalStarted;
  }

  const policyStarted = Date.now();
  let persistedConflictEvidence: MemoryExternalEvidenceSignal[] = [];
  let conflictObservationReadState: 'available' | 'failed' = 'available';
  const policyCandidateFacts = [...recalledFacts, ...resolutionFacts];
  if (policyCandidateFacts.length > 0) {
    try {
      persistedConflictEvidence = loadActiveMemoryFactConflictSignals({
        factIds: policyCandidateFacts.map((fact) => fact.id),
        currentScope: applicabilityScope,
        asOf: now,
      });
    } catch (error) {
      conflictObservationReadState = 'failed';
      retrievalState = 'degraded';
      logger.devWarn(
        'livingMemoryBridge.conflict observation read failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const applicability = applyMemoryApplicabilityPolicy({
    facts: policyCandidateFacts,
    context: {
      enabled: !disableRecall,
      now,
      useIntent: memoryUseIntent,
      scope: applicabilityScope,
      conflictObservationReadState,
      ...(persistedConflictEvidence.length > 0 || externalMemoryEvidence
        ? {
            externalEvidence: [...persistedConflictEvidence, ...(externalMemoryEvidence ?? [])],
          }
        : {}),
    },
  });
  const factDecisions = new Map(
    applicability.factDecisions.map((decision) => [decision.factId, decision] as const),
  );
  const applicableFacts: PromptMemoryFact[] = policyCandidateFacts.flatMap((fact) => {
    const decision = factDecisions.get(fact.id);
    if (!decision || decision.action === 'silent') return [];
    return [
      {
        ...fact,
        applicability: { action: decision.action, reason: decision.reason },
      },
    ];
  });
  const resolutionFactIds = selectMemoryApplicabilityResolutionFactIds(applicableFacts);
  let assemblyVisibleFacts = applicableFacts.filter(
    (fact) => fact.applicability?.action === 'use' || resolutionFactIds.has(fact.id),
  );
  const applicableProcedureSections: string[] = [];
  const procedureFactIds = new Set(
    assemblyVisibleFacts.filter(isReceiptBackedProcedureLearningFact).map((fact) => fact.id),
  );
  if (procedureFactIds.size > 0) {
    const validProcedureFactIds = new Set<string>();
    if (!disableExperienceLearningRecall) {
      for (const fact of assemblyVisibleFacts) {
        if (!procedureFactIds.has(fact.id) || fact.applicability?.action !== 'use') continue;
        const applicable = await resolveApplicableReceiptBackedProcedure({
          fact,
          memoryOwnerId: applicabilityScope.memoryOwnerId,
          asOf: now,
          ...(receiptBackedProcedureRuntime ? { runtime: receiptBackedProcedureRuntime } : {}),
        });
        if (!isMemoryReadEpochCurrent(memoryReadEpoch) || !isProjectionCurrent()) {
          return { aborted: true };
        }
        if (!applicable) continue;
        validProcedureFactIds.add(fact.id);
        applicableProcedureSections.push(applicable.section);
      }
    }
    assemblyVisibleFacts = assemblyVisibleFacts.filter(
      (fact) => !procedureFactIds.has(fact.id) || validProcedureFactIds.has(fact.id),
    );
  }
  const applicabilitySummary: MemoryApplicabilitySummary = {
    ...applicability.summary,
    promptVisibleFactCount: assemblyVisibleFacts.length,
    promptBudgetDroppedFactCount: applicableFacts.length - assemblyVisibleFacts.length,
  };
  const applicabilityPolicyMs = Date.now() - policyStarted;

  return {
    aborted: false,
    assemblyVisibleFacts,
    recalledEpisodeSelections,
    recalledEpisodes,
    applicableProcedureSections,
    applicabilitySummary,
    retrievalState,
    retrievalTimings,
    retrievalMs,
    applicabilityPolicyMs,
  };
}
