import { buildSubAgentSystemPrompt } from '../../src/services/agents/lifecycle/runConfig';
import { enforceExecutionWorkerOutputContract } from '../../src/services/agents/subAgentOutputContract';

// Traced live on `delegation-worker-evidence-chain`. The worker was asked only to return
// a token. Its Worker Contract told it to answer directly without tools; a second
// evidence section in the same prompt told it `verified_success` required completed tool
// results, and the runtime downgraded its claim for want of them. Every worker now gets
// one rule — the Worker Contract — and its report is its result, as a tool result is.
describe('every worker is told one evidence rule', () => {
  it('states the Worker Contract and no second evidence section', () => {
    const prompt = buildSubAgentSystemPrompt({}, 1);

    expect(prompt).toContain('## Worker Contract');
    expect(prompt).toContain('Never fabricate execution evidence');
    expect(prompt).not.toContain('Execution Evidence Contract');
    expect(prompt).not.toContain('verified_success');
  });
});

describe('the runtime takes the worker report as its result', () => {
  const answer = 'completionState: verified_success\nE2E-WORKER-CHAIN-77';

  it('keeps the success a worker that finished on its own answer declares', () => {
    const result = enforceExecutionWorkerOutputContract({
      output: answer,
      completionState: 'verified_success',
      terminalStatus: 'completed',
      terminalDisposition: 'final_candidate',
    });

    expect(result.completionState).toBe('verified_success');
    expect(result.output).toContain('E2E-WORKER-CHAIN-77');
  });

  it('reads a run that ended with a final answer as delivered', () => {
    expect(
      enforceExecutionWorkerOutputContract({
        output: 'E2E-WORKER-CHAIN-77',
        terminalStatus: 'completed',
        terminalDisposition: 'final_candidate',
      }).completionState,
    ).toBe('verified_success');
  });

  it('reports a run that did not finish on an answer as incomplete', () => {
    for (const result of [
      enforceExecutionWorkerOutputContract({
        output: 'Partial findings.',
        terminalStatus: 'error',
      }),
      enforceExecutionWorkerOutputContract({
        output: 'Partial findings.',
        terminalStatus: 'completed',
      }),
    ]) {
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('Partial findings.');
    }
  });
});
