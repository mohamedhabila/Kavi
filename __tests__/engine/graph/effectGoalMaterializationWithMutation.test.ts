import { materializeToolEffectCompletionGoals } from '../../../src/engine/graph/toolEffectGoalMaterialization';
import { findGoalForEffectCompletionRequirement } from '../../../src/engine/toolExecution/toolEffectCompletionContract';
import { resolveToolEffectCompletionRequirement } from '../../../src/engine/toolExecution/toolEffectCompletionContract';

// Traced live on an Android emulator, and the reason a refused effect became a loop.
//
// Effect-completion goals are materialized before the batch runs, so an effect is
// admitted on its first attempt. That step used to return early whenever the batch also
// contained update_goals — so the batch boundary refused the write, and the goal that
// would have admitted it was never created. The retry, batched the same way, failed
// identically. The model escaped only by happening to send the write on its own:
//
//   10:05:36  update_goals ok, write_file  -> goal_mutation_boundary
//   10:06:19  write_file, update_goals ok  -> goal_mutation_boundary
//   10:06:34  write_file alone             -> written
//
// The skip guarded against clobbering the model's pending mutation, which it cannot do:
// materialized goals carry code-owned effect-<tool>-<digest> ids that no model mutation
// addresses, and the canonicalization that applies the model's mutation afterwards reads
// a fresh graph snapshot.

const WRITE_ARGS = JSON.stringify({ path: 'artifacts/tl3/report.md', content: '# report' });

const writeCall = { name: 'write_file', arguments: WRITE_ARGS };
const goalCall = {
  name: 'update_goals',
  arguments: JSON.stringify({ action: 'activate', id: 'g1' }),
};

describe('materializing an effect goal beside a goal mutation', () => {
  it('materializes the admitting goal even when the batch mutates goals', async () => {
    const result = await materializeToolEffectCompletionGoals({
      toolCalls: [goalCall, writeCall],
      goals: [],
    });

    expect(result.status).toBe('materialized');

    const requirement = await resolveToolEffectCompletionRequirement({
      toolName: 'write_file',
      argumentsText: WRITE_ARGS,
    });
    if (requirement.kind !== 'effectful') {
      throw new Error('write_file must carry an effect completion contract');
    }
    expect(findGoalForEffectCompletionRequirement(result.goals, requirement)).toBeDefined();
  });

  it('produces the same goal the solo write would have produced', async () => {
    const batched = await materializeToolEffectCompletionGoals({
      toolCalls: [goalCall, writeCall],
      goals: [],
      now: 1000,
    });
    const solo = await materializeToolEffectCompletionGoals({
      toolCalls: [writeCall],
      goals: [],
      now: 1000,
    });

    expect(batched.goals.map((goal) => goal.id)).toEqual(solo.goals.map((goal) => goal.id));
  });

  it('uses a code-owned id no model mutation addresses', async () => {
    const result = await materializeToolEffectCompletionGoals({
      toolCalls: [goalCall, writeCall],
      goals: [],
    });

    expect(result.goals.every((goal) => goal.id.startsWith('effect-write-file-'))).toBe(true);
  });

  it('leaves a batch with no effect untouched', async () => {
    const result = await materializeToolEffectCompletionGoals({
      toolCalls: [goalCall],
      goals: [],
    });

    expect(result.status).toBe('unchanged');
    expect(result.goals).toHaveLength(0);
  });

  it('does not duplicate a goal that already admits the effect', async () => {
    const first = await materializeToolEffectCompletionGoals({
      toolCalls: [goalCall, writeCall],
      goals: [],
      now: 1000,
    });
    const second = await materializeToolEffectCompletionGoals({
      toolCalls: [goalCall, writeCall],
      goals: first.goals,
      now: 2000,
    });

    expect(second.status).toBe('unchanged');
    expect(second.goals).toHaveLength(first.goals.length);
  });
});
