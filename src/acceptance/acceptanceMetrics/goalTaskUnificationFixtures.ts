// ---------------------------------------------------------------------------
// Kavi — Goal ↔ task ↔ memory unification fixtures (structural)
// ---------------------------------------------------------------------------

export interface GoalTaskUnificationFixture {
  id: string;
  threadId: string;
  goalAId: string;
  goalATitle: string;
  goalBId: string;
  goalBTitle: string;
  tokenA: string;
  tokenB: string;
}

export const GOAL_TASK_UNIFICATION_FIXTURES: ReadonlyArray<GoalTaskUnificationFixture> = [
  {
    id: 'dual-goal-scoped-recall',
    threadId: 'conv-goal-task-s',
    goalAId: 'goal-task-a',
    goalATitle: 'trip-planning-scope',
    goalBId: 'goal-task-b',
    goalBTitle: 'meal-planning-scope',
    tokenA: 'SCOPE-TOKEN-A-42',
    tokenB: 'SCOPE-TOKEN-B-42',
  },
];