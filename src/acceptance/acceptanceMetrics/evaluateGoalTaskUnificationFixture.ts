// ---------------------------------------------------------------------------
// Kavi — Goal ↔ task ↔ memory unification fixture evaluator
// ---------------------------------------------------------------------------

import { applyGoalMutation } from '../../engine/goals/graphState';
import type { AgentGoal } from '../../engine/goals/types';
import { orchestrateMemoryRetrieval } from '../../services/memory/retrievalOrchestrator';
import { recordFact } from '../../services/memory/facts/mutations';
import { syncGoalTasksFromMutation } from '../../services/memory/tasks';
import { getActiveTaskTitle } from '../../services/memory/taskStack';
import type { AcceptanceFixtureOutcome } from './types';
import type { GoalTaskUnificationFixture } from './goalTaskUnificationFixtures';

function recallIncludesToken(facts: ReadonlyArray<{ objectText: string }>, token: string): boolean {
  return facts.some((fact) => fact.objectText.includes(token));
}

export async function evaluateGoalTaskUnificationFixture(
  fixture: GoalTaskUnificationFixture,
  now = 100,
): Promise<AcceptanceFixtureOutcome> {
  let goals: AgentGoal[] = [];

  const addGoalA = applyGoalMutation(
    goals,
    {
      action: 'add',
      goals: [
        {
          id: fixture.goalAId,
          title: fixture.goalATitle,
          status: 'active',
          completionPolicy: 'persistent',
        },
      ],
    },
    now,
  );
  if (addGoalA.errors.length > 0) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `add goal A failed: ${addGoalA.errors.join('; ')}`,
    };
  }
  goals = addGoalA.goals;
  syncGoalTasksFromMutation({
    threadId: fixture.threadId,
    mutation: {
      action: 'add',
      goals: [
        {
          id: fixture.goalAId,
          title: fixture.goalATitle,
          status: 'active',
          completionPolicy: 'persistent',
        },
      ],
    },
    goals,
    now,
  });

  recordFact({
    subjectId: 'entity-scope-a',
    predicate: 'scope_token',
    objectText: fixture.tokenA,
    scope: 'session',
    originThreadId: fixture.threadId,
    originTaskId: fixture.goalAId,
    now,
  });

  const addGoalB = applyGoalMutation(
    goals,
    {
      action: 'add',
      goals: [
        {
          id: fixture.goalBId,
          title: fixture.goalBTitle,
          status: 'pending',
          completionPolicy: 'persistent',
        },
      ],
    },
    now + 10,
  );
  if (addGoalB.errors.length > 0) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `add goal B failed: ${addGoalB.errors.join('; ')}`,
    };
  }
  goals = addGoalB.goals;
  syncGoalTasksFromMutation({
    threadId: fixture.threadId,
    mutation: {
      action: 'add',
      goals: [
        {
          id: fixture.goalBId,
          title: fixture.goalBTitle,
          status: 'pending',
          completionPolicy: 'persistent',
        },
      ],
    },
    goals,
    now: now + 10,
  });

  const activateGoalB = applyGoalMutation(
    goals,
    { action: 'activate', goals: [{ id: fixture.goalBId }] },
    now + 20,
  );
  if (activateGoalB.errors.length > 0) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `activate goal B failed: ${activateGoalB.errors.join('; ')}`,
    };
  }
  goals = activateGoalB.goals;
  syncGoalTasksFromMutation({
    threadId: fixture.threadId,
    mutation: { action: 'activate', goals: [{ id: fixture.goalBId }] },
    goals,
    now: now + 20,
  });

  recordFact({
    subjectId: 'entity-scope-b',
    predicate: 'scope_token',
    objectText: fixture.tokenB,
    scope: 'session',
    originThreadId: fixture.threadId,
    originTaskId: fixture.goalBId,
    now: now + 20,
  });

  if (getActiveTaskTitle(fixture.threadId) !== fixture.goalBTitle) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `task_stack title expected [${fixture.goalBTitle}] after activating goal B`,
    };
  }

  const recallForB = await orchestrateMemoryRetrieval({
    userMessage: 'scope_token',
    conversationId: fixture.threadId,
    goals,
    activeTaskId: fixture.goalBId,
    taskId: fixture.goalBId,
    limit: 8,
    now: now + 30,
  });

  if (!recallIncludesToken(recallForB.facts, fixture.tokenB)) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `active goal B recall missing token [${fixture.tokenB}]`,
    };
  }
  if (recallIncludesToken(recallForB.facts, fixture.tokenA)) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `active goal B recall leaked token [${fixture.tokenA}]`,
    };
  }

  const activateGoalA = applyGoalMutation(
    goals,
    { action: 'activate', goals: [{ id: fixture.goalAId }] },
    now + 40,
  );
  if (activateGoalA.errors.length > 0) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `reactivate goal A failed: ${activateGoalA.errors.join('; ')}`,
    };
  }
  goals = activateGoalA.goals;
  syncGoalTasksFromMutation({
    threadId: fixture.threadId,
    mutation: { action: 'activate', goals: [{ id: fixture.goalAId }] },
    goals,
    now: now + 40,
  });

  if (getActiveTaskTitle(fixture.threadId) !== fixture.goalATitle) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `task_stack title expected [${fixture.goalATitle}] after reactivating goal A`,
    };
  }

  const recallForA = await orchestrateMemoryRetrieval({
    userMessage: 'scope_token',
    conversationId: fixture.threadId,
    goals,
    activeTaskId: fixture.goalAId,
    taskId: fixture.goalAId,
    limit: 8,
    now: now + 50,
  });

  if (!recallIncludesToken(recallForA.facts, fixture.tokenA)) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `active goal A recall missing token [${fixture.tokenA}]`,
    };
  }
  if (recallIncludesToken(recallForA.facts, fixture.tokenB)) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `active goal A recall leaked token [${fixture.tokenB}]`,
    };
  }

  return {
    fixtureId: fixture.id,
    passed: true,
    detail: 'task_stack titles and scoped recall align with active graph goals',
  };
}
