import {
  isEffectAdmittedByBatchGoalMutation,
  projectInBatchGoalMutations,
  resolveLastGoalMutationIndex,
} from '../../../src/engine/graph/goalMutationBatchAdmission';
import { resolveToolEffectCompletionRequirement } from '../../../src/engine/toolExecution/toolEffectCompletionContract';
import type { AgentGoal } from '../../../src/types/agentRun';

// Traced live on an Android emulator. The model batched update_goals with the write_file
// that mutation admitted; the write was refused with goal_mutation_boundary, and the
// identical 1203-byte call was re-sent on the next iteration, where it succeeded. The
// boundary existed because a mutation commits during outcome resolution — after the batch
// — so the admission check could only ever see the pre-mutation graph.

const REPORT_PATH = 'artifacts/tl3/report.md';

function goalMutationCall(args: unknown) {
  return { name: 'update_goals', arguments: JSON.stringify(args) };
}

function writeCall(path: string) {
  return { name: 'write_file', arguments: JSON.stringify({ path, content: '# report' }) };
}

async function writeRequirement(path: string) {
  return resolveToolEffectCompletionRequirement({
    toolName: 'write_file',
    argumentsText: JSON.stringify({ path, content: '# report' }),
  });
}

/**
 * The goal that admits a write, built from the effect's own completion criterion —
 * the same shape the completion-contract repair tells the model to create.
 */
async function admittingMutationFor(path: string) {
  const requirement = await writeRequirement(path);
  const serialized =
    'serializedCriterion' in requirement ? requirement.serializedCriterion : '';

  return goalMutationCall({
    action: 'add',
    id: 'geo-report',
    name: 'Write the report',
    status: 'active',
    completionPolicy: 'blocking',
    successCriteria: [serialized],
  });
}

describe('projecting the batch its own mutations', () => {
  it('lands the goal a valid add will create', async () => {
    const projected = projectInBatchGoalMutations(
      [await admittingMutationFor(REPORT_PATH), writeCall(REPORT_PATH)],
      [],
    );

    expect(projected).toHaveLength(1);
    expect(projected[0].id).toBe('geo-report');
    expect(projected[0].status).toBe('active');
  });

  it('projects nothing for a mutation that will be rejected', () => {
    // An unregistered evidence.prefix token is refused by the same validation
    // canonicalization runs, so the goal never appears.
    const invalid = goalMutationCall({
      action: 'add',
      id: 'geo-report',
      name: 'Write the report',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.prefix:output'],
    });

    expect(projectInBatchGoalMutations([invalid], [])).toHaveLength(0);
  });

  it('projects nothing for arguments that do not parse', () => {
    const malformed = { name: 'update_goals', arguments: '{"action": "add", "goals": [' };
    expect(projectInBatchGoalMutations([malformed], [])).toHaveLength(0);
  });

  it('leaves the graph untouched when the batch mutates no goals', () => {
    const existing: AgentGoal[] = [
      {
        id: 'existing',
        title: 'Existing',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 0,
        updatedAt: 0,
      } as AgentGoal,
    ];

    expect(projectInBatchGoalMutations([writeCall(REPORT_PATH)], existing)).toBe(existing);
  });
});

describe('admitting an effect beside its mutation', () => {
  it('admits the write the batch just created a goal for', async () => {
    const calls = [await admittingMutationFor(REPORT_PATH), writeCall(REPORT_PATH)];
    const requirement = await writeRequirement(REPORT_PATH);

    expect(
      isEffectAdmittedByBatchGoalMutation({
        index: 1,
        lastGoalMutationIndex: resolveLastGoalMutationIndex(calls),
        requirement,
        projectedGoals: projectInBatchGoalMutations(calls, []),
      }),
    ).toBe(true);
  });

  it('refuses a write the projected graph does not admit', async () => {
    const calls = [await admittingMutationFor(REPORT_PATH), writeCall('artifacts/tl3/other.md')];
    const requirement = await writeRequirement('artifacts/tl3/other.md');

    expect(
      isEffectAdmittedByBatchGoalMutation({
        index: 1,
        lastGoalMutationIndex: resolveLastGoalMutationIndex(calls),
        requirement,
        projectedGoals: projectInBatchGoalMutations(calls, []),
      }),
    ).toBe(false);
  });

  it('refuses a write declared before the mutation that admits it', async () => {
    // Ordering is the whole safety argument: the mutation must resolve first.
    const calls = [writeCall(REPORT_PATH), await admittingMutationFor(REPORT_PATH)];
    const requirement = await writeRequirement(REPORT_PATH);

    expect(
      isEffectAdmittedByBatchGoalMutation({
        index: 0,
        lastGoalMutationIndex: resolveLastGoalMutationIndex(calls),
        requirement,
        projectedGoals: projectInBatchGoalMutations(calls, []),
      }),
    ).toBe(false);
  });

  it('refuses when the admitting mutation is invalid', async () => {
    const invalid = goalMutationCall({
      action: 'add',
      id: 'geo-report',
      name: 'Write the report',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.prefix:output'],
    });
    const calls = [invalid, writeCall(REPORT_PATH)];
    const requirement = await writeRequirement(REPORT_PATH);

    expect(
      isEffectAdmittedByBatchGoalMutation({
        index: 1,
        lastGoalMutationIndex: resolveLastGoalMutationIndex(calls),
        requirement,
        projectedGoals: projectInBatchGoalMutations(calls, []),
      }),
    ).toBe(false);
  });
});

describe('locating the last mutation in a batch', () => {
  it('reports -1 when the batch mutates no goals', () => {
    expect(resolveLastGoalMutationIndex([writeCall(REPORT_PATH)])).toBe(-1);
  });

  it('reports the last one when several are present', async () => {
    const mutation = await admittingMutationFor(REPORT_PATH);
    expect(resolveLastGoalMutationIndex([mutation, mutation, writeCall(REPORT_PATH)])).toBe(1);
  });
});
