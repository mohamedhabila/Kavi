import { executeToolInner } from '../../../src/engine/tools/toolDispatchRouter';

// Traced live on an Android emulator, three separate runs.
//
// A content-sniffing gate on write_file refused any document whose text "claimed a
// computation" unless the run already held a compute.execute receipt. It was narrowed
// twice — once for a supervisor transcribing a delegated worker's figures, once for a
// worker that keeps no control graph of its own — and misfired a third time on the case
// that shows the idea is unsound:
//
//   write_file artifacts/tl3/run_mc.py   ->  uncomputed_results
//
// The model was writing the Monte Carlo *script*. Source code that performs a
// computation is not a claim that the computation was performed, and the refusal
// demanded the exact action it had just blocked ("Run the computation with the python
// tool"). Worse, the refusal returned before the executor ran, so the effect receipt was
// never settled; an unsettled receipt classifies as uncertain, which raised
// tool_effect_reconciliation_required and ended the run outright.
//
// The gate is gone. This test pins the shape that used to be refused.

jest.mock('../../../src/engine/tools/toolWorkspaceCoreExecution', () => ({
  executeReadFile: jest.fn(),
  executeListFiles: jest.fn(),
  executeWriteFile: jest.fn(async (args: { path: string }) => ({
    status: 'completed' as const,
    content: JSON.stringify({ status: 'written', path: args.path }),
  })),
}));

const MONTE_CARLO_SOURCE = `import numpy as np

CAPEX = 240_000_000
TRIALS = 20_000
rng = np.random.default_rng(42)
revenue = rng.lognormal(mean=np.log(46_000_000), sigma=0.30, size=TRIALS)
npv = (revenue - 11_000_000) * 10.594 - CAPEX
print("P10", np.percentile(npv, 10))
print("P50", np.percentile(npv, 50))
print("mean NPV", npv.mean(), "probability positive", (npv > 0).mean())
`;

const REPORT_WITH_FIGURES = `# Feasibility verdict

The Monte Carlo simulation over 20,000 trials yields a P50 NPV of $11.3M,
a mean of $12.1M and a probability of a positive NPV of 61%.
`;

async function write(path: string, content: string) {
  return executeToolInner('write_file', JSON.stringify({ path, content }), 'conv-1');
}

describe('write_file does not sniff content for computation claims', () => {
  it('writes a simulation script, the case that ended a traced run', async () => {
    const outcome = await write('artifacts/tl3/run_mc.py', MONTE_CARLO_SOURCE);
    expect(outcome.status).toBe('completed');
  });

  it('writes a report carrying figures without demanding a receipt first', async () => {
    const outcome = await write('artifacts/tl3/report.md', REPORT_WITH_FIGURES);
    expect(outcome.status).toBe('completed');
  });

  it('never answers a write with the uncomputed_results refusal', async () => {
    for (const [path, content] of [
      ['artifacts/tl3/run_mc.py', MONTE_CARLO_SOURCE],
      ['artifacts/tl3/report.md', REPORT_WITH_FIGURES],
    ] as const) {
      const outcome = await write(path, content);
      expect(outcome.content ?? '').not.toContain('uncomputed_results');
      expect(outcome.content ?? '').not.toContain('tool_effect_reconciliation_required');
    }
  });
});
