import {
  checkComputedClaimDisclosure,
  claimsComputationWasPerformed,
  runHasComputeEvidence,
} from '../../../src/engine/tools/computedClaimDisclosure';
import { buildToolEffectReceiptEvidence } from '../../../src/engine/goals/effectCompletionEvidence';
import { createGoal } from '../../../src/engine/goals/types';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';

// Traced on-device. A feasibility study that could not reach a code-execution tool wrote
// "The Monte Carlo simulation (100,000 trials) ... yields a P50 NPV of $11.3M" with a
// results table and a GO recommendation. Nothing was computed. A probe over both
// artifacts found no hedging language anywhere; the failure was mentioned only in chat.
const FABRICATED = `# Verdict: GO

The Monte Carlo simulation (100,000 trials) yields a **P50 NPV of $11.3M**, with a P10 of
-$17.1M and a P90 of $43.0M. The probability of a negative NPV is 32.4%. The mean NPV is
$12.7M with a standard deviation of $23.1M.`;

function computeReceipt(): string {
  const d = `sha256:${'5'.repeat(64)}` as const;
  return buildToolEffectReceiptEvidence({
    version: 2,
    receiptId: `ter_${'a'.repeat(32)}`,
    toolCallId: 'call-py',
    toolName: 'python',
    executionRunId: 'run-1',
    contractIdentity: {
      kind: 'code_owned', version: 1, toolName: 'python', schemaDigest: d,
      capabilityContractDigest: d, workflowContractDigest: d,
      effectContractDigest: d, executionPolicyDigest: d,
    },
    transportState: 'returned',
    effectKind: 'compute.execute',
    effectState: 'applied',
    executionState: 'completed',
    verificationState: 'verified',
    requestDigest: `sha256:${'1'.repeat(64)}`,
    resultDigest: `sha256:${'2'.repeat(64)}`,
    resource: { kind: 'effect_request', id: `sha256:${'1'.repeat(64)}` },
    recordedAt: 1,
  } satisfies ToolEffectReceipt);
}

const goalsWithCompute = [createGoal({ id: 'g', title: 'g', evidence: [computeReceipt()] })];
const goalsWithoutCompute = [createGoal({ id: 'g', title: 'g', evidence: ['read_file:a.md'] })];

const check = (content: string, goals = goalsWithoutCompute) =>
  checkComputedClaimDisclosure({ path: 'artifacts/verdict.md', content, goals });

describe('a document may not present figures the run never computed', () => {
  it('refuses the traced fabrication', () => {
    const refusal = check(FABRICATED);

    expect(refusal).toContain('uncomputed_results');
    expect(refusal).toContain('artifacts/verdict.md');
  });

  it('names both legal ways forward, so there is always a move', () => {
    const refusal = check(FABRICATED) ?? '';

    expect(refusal).toMatch(/python or javascript/i);
    expect(refusal).toMatch(/could not be run/i);
  });

  it('allows the identical document once the run actually computed', () => {
    expect(check(FABRICATED, goalsWithCompute)).toBeNull();
  });

  it('allows it when the document says the computation did not run', () => {
    expect(check(`${FABRICATED}\n\nNote: the simulation could not be run.`)).toBeNull();
  });
});

describe('reporting numbers is not the trigger', () => {
  it('allows a research note full of measurements', () => {
    const research = `# Dossier
- Jupiter is 1,898,000 trillion tonnes and 142,984 km across.
- Its mean orbital radius is 778 million km.
Source: https://example.com`;

    expect(check(research)).toBeNull();
    expect(claimsComputationWasPerformed(research)).toBe(false);
  });

  it('allows prose that merely mentions a simulation without reporting results', () => {
    expect(check('We considered running a Monte Carlo simulation in phase 2.')).toBeNull();
  });

  it('allows an empty or numberless document', () => {
    expect(check('')).toBeNull();
    expect(check('# Notes\nNothing quantitative here.')).toBeNull();
  });
});

describe('compute evidence is read from the run, not claimed by the caller', () => {
  it('recognises a completed compute receipt', () => {
    expect(runHasComputeEvidence(goalsWithCompute)).toBe(true);
  });

  it('does not accept an unrelated tool result as compute', () => {
    expect(runHasComputeEvidence(goalsWithoutCompute)).toBe(false);
  });

  it('does not answer for a run that tracks no evidence at all', () => {
    // A delegated worker keeps no graph of its own, so a missing compute receipt there
    // means "nothing is recorded here", not "nothing was computed". Traced live: a worker
    // computed with numpy, was refused its write, and the refusal blocked its graph.
    expect(runHasComputeEvidence(undefined)).toBe(true);
    expect(runHasComputeEvidence([])).toBe(true);
  });
});
