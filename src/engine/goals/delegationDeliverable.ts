import type { AgentGoal } from './types';

/**
 * What a delegated worker is expected to produce.
 *
 * `effect` — the deliverable is a change in the world: a file written, an event created,
 * a message sent. Completed tool results are the only honest proof of those, so the
 * worker must present them before its report counts as verified.
 *
 * `information` — the deliverable is an answer: a value looked up, a summary, a decision.
 * A worker doing exactly this answers from the prompt and visible context and makes no
 * state-changing calls, so it has no execution evidence to present and never will.
 */
export type DelegatedDeliverableKind = 'effect' | 'information';

/**
 * Criterion prefixes that only a completed tool execution can satisfy. A goal carrying
 * any of these is asking for a change in the world, so its worker owes proof of one.
 */
const EXECUTION_PROOF_CRITERION_PREFIXES = [
  'evidence.tool:',
  'evidence.artifact:',
  'evidence.file_hash:',
  'evidence.json_field:',
  'evidence.exit_code:',
  'evidence.effect:',
] as const;

/**
 * Resolve what a delegated worker owes, from the goal that scopes it.
 *
 * The supervisor already states the contract when it writes the goal's success criteria,
 * so the deliverable kind is read from graph state rather than asked for again or
 * inferred from the worker's own claims.
 *
 * Traced live on `delegation-worker-evidence-chain`: the worker was asked only to return
 * a token. Its own contract told it to answer directly without tools and, in the same
 * prompt, that `verified_success` requires completed tool results — so it answered
 * correctly and could not report success, the goal never received worker evidence, and
 * the supervisor re-delegated until the run hit its ceiling.
 *
 * A worker that delegates further holds no supervisor graph, so the scoping goal is
 * unreachable from there. `options.inherited` carries the parent's already-resolved
 * answer down to that child, which serves the same contract. Absence of a goal, of
 * criteria, and of an inherited answer all keep the stricter bar: this only ever relaxes
 * where a goal states that a worker report is the deliverable.
 */
export function resolveDelegatedDeliverableKind(
  goal: Pick<AgentGoal, 'successCriteria'> | undefined,
  options: { inherited?: DelegatedDeliverableKind } = {},
): DelegatedDeliverableKind {
  const criteria = (goal?.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter(Boolean);
  if (criteria.length === 0) {
    // No criteria to read: a nested worker cannot see the supervisor graph that scopes
    // it, so an answer carried down from its parent is better evidence of the contract
    // than the strict default. With neither, the strict bar stands.
    return options.inherited ?? 'effect';
  }

  const demandsExecutionProof = criteria.some((criterion) =>
    EXECUTION_PROOF_CRITERION_PREFIXES.some((prefix) => criterion.startsWith(prefix)),
  );
  return demandsExecutionProof ? 'effect' : 'information';
}
