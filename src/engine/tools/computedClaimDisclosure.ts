import { parseToolEffectReceiptEvidence } from '../goals/effectCompletionEvidence';
import type { AgentGoal } from '../goals/types';

/**
 * Refuses to write a document that claims a computation the run never performed.
 *
 * Traced on-device. Asked for a feasibility study with Monte Carlo simulations, the run
 * could not reach a code-execution tool, and instead of stopping it wrote
 * `verdict.md` opening "The Monte Carlo simulation (100,000 trials) ... yields a P50 NPV
 * of $11.3M", with a results table and a GO recommendation. No trial was ever run. The
 * only disclosure was a line in the chat transcript, which nobody reads once the file
 * exists, and a probe over both artifacts found no hedging language at all.
 *
 * Guidance cannot fix this: the model already knew it had failed and said so in chat. So
 * the check is mechanical and code-owned, in the same spirit as the memory predicate
 * guard — a documented rule nothing enforced until something did.
 *
 * The discriminator was confirmed against both a failing and a healthy run. A legitimate
 * study writes its figures after `executePythonTool` has run, leaving a `compute.execute`
 * receipt on the run's goals; the fabricated one wrote the same shaped document with no
 * receipt anywhere. Reporting numbers is not the trigger — a research note full of
 * measurements is fine. The trigger is *claiming they were computed*.
 */

/** Words that assert a computation was performed, rather than merely reporting a number. */
const COMPUTATION_CLAIM_PATTERN =
  /\b(monte[\s-]?carlo|simulation|simulated|trials|iterations of the model|computed|calculated by|solver|regression|percentiles?)\b/i;

/** Statistical outputs a computation produces. Two or more read as a results report. */
const STATISTICAL_RESULT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bP(?:10|50|90)\b/i,
  /\b(?:mean|median|average)\b/i,
  /\b(?:std(?:ev|\.)?|standard deviation|σ)\b/i,
  /\bprobability\b/i,
  /\b(?:npv|irr|payback)\b/i,
  /\bconfidence interval\b/i,
];

/** Language that already tells the reader the figures were not produced by a run. */
const DISCLOSURE_PATTERN =
  /\b(could not (?:be )?(?:run|computed?)|unable to (?:run|compute)|not (?:actually )?(?:run|executed|computed)|did not run|no simulation was run|hypothetical|illustrative|indicative only|placeholder|worked example|for illustration)\b/i;

export function claimsComputationWasPerformed(content: string): boolean {
  if (!content || !/\d/.test(content)) {
    return false;
  }
  if (!COMPUTATION_CLAIM_PATTERN.test(content)) {
    return false;
  }
  const statisticalSignals = STATISTICAL_RESULT_PATTERNS.filter((pattern) =>
    pattern.test(content),
  ).length;
  return statisticalSignals >= 2;
}

export function disclosesTheComputationDidNotRun(content: string): boolean {
  return Boolean(content) && DISCLOSURE_PATTERN.test(content);
}

/** Whether this run actually executed code, per its own effect receipts. */
export function runHasComputeEvidence(
  goals: ReadonlyArray<AgentGoal> | undefined,
): boolean {
  if (!goals?.length) {
    return false;
  }
  return goals.some((goal) =>
    goal.evidence.some((entry) => {
      const receipt = parseToolEffectReceiptEvidence(entry);
      return (
        receipt?.effectKind === 'compute.execute' &&
        receipt.transportState === 'returned' &&
        receipt.executionState === 'completed'
      );
    }),
  );
}

/**
 * The refusal, when a write would assert results the run never produced. Names both
 * legal ways forward so the model is never left without a move.
 */
export function buildUncomputedClaimRefusal(path: string): string {
  return (
    `uncomputed_results: this write to ${path} states figures as the output of a ` +
    `computation, but no code execution completed in this run, so there are no results ` +
    `to report. Run the computation with the python or javascript tool and write the ` +
    `figures it returns, or say plainly in the document that the computation could not ` +
    `be run and label the numbers as not computed. Do not present unrun figures as results.`
  );
}

/** The guard, as one decision. Returns a refusal message, or null to allow the write. */
export function checkComputedClaimDisclosure(params: {
  path: string;
  content: string;
  goals: ReadonlyArray<AgentGoal> | undefined;
}): string | null {
  if (!claimsComputationWasPerformed(params.content)) {
    return null;
  }
  if (disclosesTheComputationDidNotRun(params.content)) {
    return null;
  }
  if (runHasComputeEvidence(params.goals)) {
    return null;
  }
  return buildUncomputedClaimRefusal(params.path);
}
