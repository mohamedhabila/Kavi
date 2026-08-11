export const DELEGATED_WORKER_GOAL_OWNER = 'delegated-worker' as const;
export const DELEGATED_WORKER_EVIDENCE_CRITERION = 'evidence.prefix:worker' as const;
export const DELEGATED_WORKER_MIN_EVIDENCE_CRITERION = 'evidence.min:1' as const;
export const DELEGATED_WORKER_LAUNCH_EVIDENCE_PREFIX = 'delegation_launch:' as const;

/**
 * Evidence that a delegated worker produced a workspace artifact.
 *
 * An `evidence.artifact:<path>` criterion is met by a verified `artifact.write` receipt,
 * and a receipt only ever lands on the graph of the run that performed the write. When a
 * worker writes the deliverable, the supervisor's own goal therefore stays unsatisfied
 * however plainly the file exists.
 *
 * Traced on-device: a worker computed a study and wrote `artifacts/wind/verdict.md`; the
 * supervisor read it back, confirmed it, then could not close its goal. It issued four
 * `update_goals` calls, concluded "the goal system requires the artifact to be written
 * from this session", and re-wrote the correct file purely as bookkeeping.
 *
 * This is a separate evidence form rather than a synthesized receipt. A receipt attests
 * that *this* run performed an effect, derived from the tool's real result under a
 * code-owned contract; minting one for work another run did would forge exactly what it
 * exists to prove. This records the true statement instead — a delegated worker produced
 * this path — and the artifact criterion accepts it as satisfying the deliverable. It
 * stays code-owned: the paths come from the worker's actual tool results, never prose.
 */
export const DELEGATED_ARTIFACT_EVIDENCE_PREFIX = 'delegated_artifact:' as const;

export function buildDelegatedArtifactEvidence(workspacePath: string): string {
  return `${DELEGATED_ARTIFACT_EVIDENCE_PREFIX}${workspacePath.trim()}`;
}

export function readDelegatedArtifactEvidencePath(evidence: string): string | undefined {
  const trimmed = evidence.trim();
  if (!trimmed.startsWith(DELEGATED_ARTIFACT_EVIDENCE_PREFIX)) {
    return undefined;
  }
  const path = trimmed.slice(DELEGATED_ARTIFACT_EVIDENCE_PREFIX.length).trim();
  return path || undefined;
}

/**
 * Whether a goal's success contract belongs to a delegated worker rather than to the run
 * holding it.
 *
 * A delegation goal states "a worker delivered": `sessions_spawn` requires the supervisor
 * to create it as a separate goal owned by `delegated-worker`, and says in as many words
 * not to repurpose a parent deliverable. It is therefore not a container for whatever the
 * supervisor happens to do while the worker runs — neither its tool output nor the
 * criteria that output would imply.
 *
 * Evidence routing has always honoured this. Effect-completion materialization did not,
 * and grafted its criterion onto whichever goal was active and blocking — in a delegation
 * run, always the delegation goal. Because blocking criteria are monotonic, the grafted
 * criterion could never be removed and the goal could never complete. Traced live on
 * `delegation-worker-evidence-chain`: criteria ended as the two the supervisor declared
 * plus a 319-character code-owned effect criterion, with every evidence entry an effect
 * receipt and none from the worker, scoring 0/4 in every recorded run.
 */
export function isDelegationOwnedGoal(goal: { owner?: string }): boolean {
  return goal.owner?.trim() === DELEGATED_WORKER_GOAL_OWNER;
}

export function buildDelegatedWorkerLaunchEvidence(sessionId: string): string {
  return `${DELEGATED_WORKER_LAUNCH_EVIDENCE_PREFIX}${sessionId.trim()}`;
}

export function readDelegatedWorkerLaunchSessionId(evidence: string): string | undefined {
  if (!evidence.startsWith(DELEGATED_WORKER_LAUNCH_EVIDENCE_PREFIX)) return undefined;
  const sessionId = evidence.slice(DELEGATED_WORKER_LAUNCH_EVIDENCE_PREFIX.length).trim();
  return sessionId || undefined;
}

/**
 * Whether a success criterion can only be satisfied by the supervisor that delegated.
 *
 * `evidence.prefix:worker` asserts that a worker produced the result. On the supervisor's
 * graph that is exactly right. Handed to the worker it is unsatisfiable: inside the worker
 * there is no worker-result evidence, because the worker is the worker.
 *
 * Traced live on an Android emulator. The supervisor's goal criteria were passed verbatim
 * into the worker prompt, the worker copied them onto its own goal, wrote its deliverable
 * (risks.md, 2673 chars), read it back, and was refused on completion with "Unmet criteria:
 * evidence.prefix:worker. To record it: produce a worker result" — the thing it had just
 * done. It stalled there and was later terminalized, and the parent run ended at step four
 * of five with a spawn that never returned.
 */
export function isSupervisorOnlySuccessCriterion(criterion: string): boolean {
  return criterion.trim() === DELEGATED_WORKER_EVIDENCE_CRITERION;
}

/** The delegating goal's criteria, less the ones only the supervisor can satisfy. */
export function resolveWorkerVisibleSuccessCriteria(
  criteria: ReadonlyArray<string> | undefined,
): string[] | undefined {
  if (!criteria?.length) {
    return undefined;
  }
  const visible = criteria.filter((criterion) => !isSupervisorOnlySuccessCriterion(criterion));
  return visible.length > 0 ? visible : undefined;
}
