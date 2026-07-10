import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import type { E2ERubric, E2EScenarioResult, E2EScenarioTurnTrace } from './types';

type E2ETurnStageRubric = Extract<
  E2ERubric,
  {
    kind: 'turn_route' | 'turn_completion' | 'turn_memory_receipt' | 'turn_lifecycle_boundary';
  }
>;

function findTurnTrace(
  result: E2EScenarioResult,
  turnIndex: number,
): E2EScenarioTurnTrace | undefined {
  return result.turnTraces.find((turn) => turn.turnIndex === turnIndex);
}

function missingTurnOutcome(fixtureId: string, turnIndex: number): AcceptanceFixtureOutcome {
  return {
    fixtureId,
    passed: false,
    detail: `turn ${turnIndex} trace missing`,
  };
}

export function evaluateE2ETurnStageRubric(
  result: E2EScenarioResult,
  rubric: E2ETurnStageRubric,
): AcceptanceFixtureOutcome {
  const fixtureId = `${result.fixtureId}:${rubric.kind}`;
  const turn = findTurnTrace(result, rubric.turnIndex);
  if (!turn) {
    return missingTurnOutcome(fixtureId, rubric.turnIndex);
  }

  switch (rubric.kind) {
    case 'turn_route':
      if (turn.route.directive !== rubric.directive || turn.route.mode !== rubric.mode) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} route ${turn.route.directive}/${turn.route.mode} (expected ${rubric.directive}/${rubric.mode})`,
        };
      }
      return { fixtureId, passed: true };

    case 'turn_completion': {
      const completion = turn.completion;
      if (
        completion.executionCompleted !== rubric.executionCompleted ||
        completion.finalResponseCompleted !== rubric.finalResponseCompleted ||
        completion.runCompleted !== rubric.runCompleted
      ) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} completion execution=${completion.executionCompleted} finalResponse=${completion.finalResponseCompleted} run=${String(completion.runCompleted)} (expected execution=${rubric.executionCompleted} finalResponse=${rubric.finalResponseCompleted} run=${String(rubric.runCompleted)})`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'turn_memory_receipt': {
      const receipts = turn.memory.flatMap((snapshot) =>
        snapshot.lifecycle.jobId
          ? snapshot.receipts.filter((receipt) => receipt.jobId === snapshot.lifecycle.jobId)
          : [],
      );
      if (receipts.length === 0) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} durable memory receipt missing`,
        };
      }
      if (
        rubric.providerOutcome !== undefined &&
        !receipts.some((receipt) => receipt.providerOutcome === rubric.providerOutcome)
      ) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} durable memory receipt outcome ${rubric.providerOutcome} not observed`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'turn_lifecycle_boundary': {
      const lifecycle = turn.lifecycleBefore;
      if (
        !lifecycle ||
        lifecycle.boundary !== rubric.boundary ||
        lifecycle.chatStore !== 'rehydrated' ||
        lifecycle.memoryStore !== 'reopened'
      ) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} app relaunch lifecycle boundary not observed`,
        };
      }
      return { fixtureId, passed: true };
    }
  }
}
