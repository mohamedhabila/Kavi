import { buildSubAgentSystemPrompt } from '../../src/services/agents/lifecycle/runConfig';
import { enforceExecutionWorkerOutputContract } from '../../src/services/agents/subAgentOutputContract';
import { resolveDelegatedDeliverableKind } from '../../src/engine/goals/delegationDeliverable';
import {
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
} from '../../src/engine/goals/delegation';

// Traced live on `delegation-worker-evidence-chain`. The worker was asked only to return
// a token. Its Worker Contract told it to answer directly without tools; the Execution
// Evidence Contract in the same prompt told it `verified_success` requires completed tool
// results. It answered correctly and could not report success, so its goal never received
// worker evidence and the supervisor re-delegated until the run hit its ceiling. Two
// places had to agree for that to be fixed: what the worker is told, and what the runtime
// then accepts from it.
function prompt(deliverableKind?: 'effect' | 'information'): string {
  return buildSubAgentSystemPrompt(
    { workstreamId: 'worker-chain', ...(deliverableKind ? { deliverableKind } : {}) },
    1,
  );
}

describe('the worker is told an evidence rule that matches its deliverable', () => {
  it('demands completed tool results when the deliverable changes something', () => {
    expect(prompt('effect')).toContain(
      'Use verified_success only when completed tool results or structured workflow records',
    );
  });

  it('does not forbid success for a task that asks only for an answer', () => {
    const informational = prompt('information');

    expect(informational).not.toContain('Use verified_success only when completed tool results');
    expect(informational).toContain('asks for an answer rather than a change');
  });

  it('still requires proof for any part of an answer task that does change something', () => {
    // Relaxing must not become a blanket exemption: a lookup that also writes a file
    // still owes proof of the write.
    expect(prompt('information')).toContain(
      'that part still needs completed tool results',
    );
  });

  it('keeps the strict clause when the deliverable kind is unknown', () => {
    expect(prompt()).toContain('Use verified_success only when completed tool results');
  });

  it('omits the contract entirely for a worker with no workstream', () => {
    expect(buildSubAgentSystemPrompt({}, 1)).not.toContain('Execution Evidence Contract');
  });
});

describe('the runtime accepts what it told the worker to produce', () => {
  const answer = 'completionState: verified_success\nE2E-WORKER-CHAIN-77';

  function enforce(requireStructuredExecutionEvidence: boolean) {
    return enforceExecutionWorkerOutputContract({
      output: answer,
      completionState: 'verified_success',
      toolsUsed: [],
      toolResultPreviews: [],
      requireStructuredExecutionEvidence,
      terminalStatus: 'completed',
    });
  }

  it('keeps verified_success for an answer the worker actually produced', () => {
    expect(enforce(false).completionState).toBe('verified_success');
  });

  it('still downgrades an unproven claim about a change to the world', () => {
    // The anti-hallucination bar is untouched for effectful deliverables.
    expect(enforce(true).completionState).toBe('blocked');
  });

  it('preserves the answer either way so the supervisor can read it', () => {
    expect(enforce(false).output).toContain('E2E-WORKER-CHAIN-77');
    expect(enforce(true).output).toContain('E2E-WORKER-CHAIN-77');
  });
});

describe('the deliverable kind comes from the goal, not from the worker', () => {
  it('reads a worker-report contract as informational', () => {
    expect(
      resolveDelegatedDeliverableKind({
        successCriteria: [
          DELEGATED_WORKER_EVIDENCE_CRITERION,
          DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
        ],
      }),
    ).toBe('information');
  });

  it.each([
    'evidence.tool:write_file',
    'evidence.artifact:notes.md',
    'evidence.file_hash:out.txt:sha256',
    'evidence.json_field:calendar.allowsModifications:true',
    'evidence.exit_code:0',
    'evidence.effect:artifact.write',
  ])('reads %s as an effect contract', (criterion) => {
    expect(resolveDelegatedDeliverableKind({ successCriteria: [criterion] })).toBe('effect');
  });

  it('owes proof when any criterion demands it, even mixed with a report', () => {
    expect(
      resolveDelegatedDeliverableKind({
        successCriteria: [DELEGATED_WORKER_EVIDENCE_CRITERION, 'evidence.artifact:out.md'],
      }),
    ).toBe('effect');
  });

  it('keeps the stricter bar with no goal or no criteria', () => {
    expect(resolveDelegatedDeliverableKind(undefined)).toBe('effect');
    expect(resolveDelegatedDeliverableKind({ successCriteria: [] })).toBe('effect');
    expect(resolveDelegatedDeliverableKind({ successCriteria: ['   '] })).toBe('effect');
  });

  it('carries the parent answer down to a worker that cannot see the graph', () => {
    // Traced live: every depth-0 spawn resolved `information`, while the depth-1 child of
    // one of them carried no kind and was held to evidence it had no way to produce. A
    // nested worker serves the same contract as its parent.
    expect(resolveDelegatedDeliverableKind(undefined, { inherited: 'information' })).toBe(
      'information',
    );
    expect(resolveDelegatedDeliverableKind({ successCriteria: [] }, { inherited: 'effect' })).toBe(
      'effect',
    );
  });

  it('still keeps the stricter bar when nothing is inherited either', () => {
    expect(resolveDelegatedDeliverableKind(undefined, {})).toBe('effect');
    expect(resolveDelegatedDeliverableKind(undefined, { inherited: undefined })).toBe('effect');
  });

  it('never lets an inherited answer override a goal that is actually readable', () => {
    // The graph is the authority whenever it can answer; inheritance is only a fallback.
    expect(
      resolveDelegatedDeliverableKind(
        { successCriteria: ['evidence.artifact:out.md'] },
        { inherited: 'information' },
      ),
    ).toBe('effect');
    expect(
      resolveDelegatedDeliverableKind(
        { successCriteria: [DELEGATED_WORKER_EVIDENCE_CRITERION] },
        { inherited: 'effect' },
      ),
    ).toBe('information');
  });
});
