import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import type { E2ERubric, E2EScenarioResult, E2EScenarioTurnTrace } from './types';

type E2ETurnStageRubric = Extract<
  E2ERubric,
  {
    kind:
      | 'turn_route'
      | 'turn_completion'
      | 'turn_memory_receipt'
      | 'turn_lifecycle_boundary'
      | 'turn_final_response_token';
  }
>;

type E2ETurnCompletionRubric = Extract<E2ERubric, { kind: 'turn_completion' }>;
const TURN_COMPLETION_FIELDS = new Set(['execution', 'final_response', 'agent_run']);

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

function fixtureIdForRubric(result: E2EScenarioResult, rubric: E2ETurnStageRubric): string {
  if (rubric.kind === 'turn_completion') {
    return `${result.fixtureId}:${rubric.kind}:${rubric.field}`;
  }
  if (rubric.kind === 'turn_final_response_token') {
    return `${result.fixtureId}:turn-${rubric.turnIndex}:${rubric.kind}`;
  }
  return `${result.fixtureId}:${rubric.kind}`;
}

function hasValidCompletionExpectation(rubric: E2ETurnCompletionRubric): boolean {
  if (!TURN_COMPLETION_FIELDS.has(rubric.field)) {
    return false;
  }
  return rubric.field === 'agent_run'
    ? typeof rubric.expected === 'boolean' || rubric.expected === null
    : typeof rubric.expected === 'boolean';
}

export function evaluateE2ETurnStageRubric(
  result: E2EScenarioResult,
  rubric: E2ETurnStageRubric,
): AcceptanceFixtureOutcome {
  const fixtureId = fixtureIdForRubric(result, rubric);
  if (rubric.kind === 'turn_completion' && !hasValidCompletionExpectation(rubric)) {
    return {
      fixtureId,
      passed: false,
      detail: `turn completion field ${rubric.field} has an invalid expected value`,
    };
  }
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
      const actual =
        rubric.field === 'execution'
          ? completion.executionCompleted
          : rubric.field === 'final_response'
            ? completion.finalResponseCompleted
            : completion.runCompleted;
      if (actual !== rubric.expected) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} completion ${rubric.field}=${String(actual)} (expected ${String(rubric.expected)})`,
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

    case 'turn_final_response_token': {
      if (!rubric.token || rubric.token !== rubric.token.trim() || rubric.token.length > 256) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} final response token expectation is invalid`,
        };
      }
      if (!turn.finalAssistant?.text.includes(rubric.token)) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} exact final response token missing`,
        };
      }
      return { fixtureId, passed: true };
    }
  }
}
