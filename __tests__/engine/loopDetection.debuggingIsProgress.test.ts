import {
  buildGoalProgressFingerprint,
  buildToolMultisetKey,
  detectLoops,
  type IterationProgressSignature,
  type ToolCallRecord,
} from '../../src/engine/loopDetection';
import type { AgentGoal } from '../../src/engine/goals/types';

// Traced live on an Android emulator. The model ran a Monte Carlo NPV in python, read
// ~-4400M where ~+130M was expected, and set about isolating the bug:
//
//   [A] ['python'] | Now Step 2: run the Monte Carlo NPV analysis with numpy.
//   [A] ['python'] | The NPV results look wrong (all ~-4400M, expected ~+130M). Let me debug.
//   [A] ['python'] | There's a discrepancy between the vectorized and manual NPV. Let me isolate it.
//   [A] []         | I stopped because I was repeating the same step without making progress.
//
// Three different programs, three different outputs, a real defect correctly diagnosed —
// killed loop_detected on the third call. Goal state is unchanged while debugging (nothing
// is delivered until the bug is found) and the tool name is the same (isolating one problem
// means using one tool), so the only signal left is whether each call asked something new
// and got something new back.

function pythonCall(index: number): ToolCallRecord {
  return {
    name: 'python',
    arguments: JSON.stringify({ code: `# attempt ${index}\nprint(npv_${index})` }),
    status: 'completed',
    result: JSON.stringify({ status: 'ok', stdout: `npv = ${-4400 + index * 37}M` }),
    timestamp: index,
  };
}

const INCOMPLETE_BLOCKING_GOAL: AgentGoal = {
  id: 'mc-npv',
  title: 'Monte Carlo NPV',
  status: 'active',
  dependencies: [],
  evidence: [],
  completionPolicy: 'blocking',
  successCriteria: ['evidence.artifact:artifacts/npv.md'],
  createdAt: 0,
  updatedAt: 0,
} as AgentGoal;

function stagnantSignatures(count: number): IterationProgressSignature[] {
  // What the graph actually recorded: same tool, unchanged goals, and an empty semantic
  // fingerprint because python is not an inspection tool.
  return Array.from({ length: count }, () => ({
    toolMultisetKey: buildToolMultisetKey(['python']),
    goalProgressFingerprint: buildGoalProgressFingerprint([INCOMPLETE_BLOCKING_GOAL]),
    activeGoalId: 'mc-npv',
    semanticProgressFingerprint: '',
  }));
}

describe('iterating on a bug is not a loop', () => {
  it('lets three distinct python calls through', () => {
    const history = [pythonCall(1), pythonCall(2), pythonCall(3)];
    const result = detectLoops(history, stagnantSignatures(3), {
      goals: [INCOMPLETE_BLOCKING_GOAL],
    });

    expect(result.loopDetected).toBe(false);
  });

  it('does not end the run, which is what the refusal cost', () => {
    const history = [pythonCall(1), pythonCall(2), pythonCall(3)];
    const result = detectLoops(history, stagnantSignatures(3), {
      goals: [INCOMPLETE_BLOCKING_GOAL],
    });

    expect(result.level).not.toBe('critical');
  });
});

describe('spinning is still a loop', () => {
  it('catches a call that keeps producing the same answer', () => {
    const stuck = (index: number): ToolCallRecord => ({
      ...pythonCall(index),
      result: JSON.stringify({ status: 'ok', stdout: 'npv = -4400M' }),
    });
    const result = detectLoops([stuck(1), stuck(2), stuck(3)], stagnantSignatures(3), {
      goals: [INCOMPLETE_BLOCKING_GOAL],
    });

    expect(result.loopDetected).toBe(true);
  });

  it('catches identical calls, which ask nothing new', () => {
    const same = [pythonCall(1), pythonCall(1), pythonCall(1)];
    const result = detectLoops(same, stagnantSignatures(3), {
      goals: [INCOMPLETE_BLOCKING_GOAL],
    });

    expect(result.loopDetected).toBe(true);
  });

  it('catches a window where the calls kept failing', () => {
    const failing = [pythonCall(1), pythonCall(2), pythonCall(3)].map((entry) => ({
      ...entry,
      status: 'failed' as const,
    }));
    const result = detectLoops(failing, stagnantSignatures(3), {
      goals: [INCOMPLETE_BLOCKING_GOAL],
    });

    expect(result.loopDetected).toBe(true);
  });
});
