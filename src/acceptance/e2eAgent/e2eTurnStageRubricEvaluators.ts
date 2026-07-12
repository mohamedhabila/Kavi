import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import { ALL_NATIVE_TOOL_DEFINITIONS } from '../../engine/tools/native/definitions';
import { evaluateE2EMemoryProbeRubric } from './e2eMemoryProbeRubricEvaluators';
import type {
  E2EClarificationMissingField,
  E2ERubric,
  E2EScenarioResult,
  E2EScenarioTurnTrace,
} from './types';

type E2ETurnStageRubric = Extract<
  E2ERubric,
  {
    kind:
      | 'turn_route'
      | 'turn_completion'
      | 'turn_memory_receipt'
      | 'turn_lifecycle_boundary'
      | 'turn_final_response_token'
      | 'turn_clarification'
      | 'turn_native_invocation_count'
      | 'turn_memory_answer'
      | 'turn_memory_selection';
  }
>;

type E2ETurnCompletionRubric = Extract<E2ERubric, { kind: 'turn_completion' }>;
const TURN_COMPLETION_FIELDS = new Set(['execution', 'final_response', 'agent_run']);
const NATIVE_TOOL_NAMES = new Set(ALL_NATIVE_TOOL_DEFINITIONS.map((tool) => tool.name));
const CLARIFICATION_FIELD_PATTERNS = {
  event_title: [
    /\b(?:event|meeting|appointment)\s+(?:name|title)\b/iu,
    /\bwhat\s+(?:should|is)\s+(?:the\s+)?(?:event|meeting|appointment)\s+(?:be\s+)?called\b/iu,
  ],
  message_body: [
    /\b(?:message|text)\s+(?:body|content|wording)\b/iu,
    /\bwhat\s+(?:message|text)\s+(?:should\s+i\s+send|would\s+you\s+like)\b/iu,
  ],
  new_start_time: [
    /\b(?:new|updated|different|desired|preferred|target|specific)\s+(?:start(?:ing)?\s+)?(?:date(?:\s+and\s+time)?|time|schedule)\b/iu,
    /\bwhat\s+(?:new\s+)?(?:date|time)\b/iu,
    /\bwhen\s+(?:should|would|do|can|could|you(?:'d|\s+would)?)\b/iu,
  ],
  recipient: [
    /\b(?:message|email|text)\s+recipient\b/iu,
    /\b(?:who|whom)\s+(?:should|would|do|are)\b/iu,
  ],
} as const;
const CLARIFICATION_INTENT_PATTERN =
  /(?:\?|\b(?:need|missing|provide|choose|specify|tell\s+me|let\s+me\s+know|what|which|when|who|whom|could\s+you|can\s+you|please)\b)/iu;
const NEGATED_CLARIFICATION_PATTERN =
  /\b(?:nothing|no\s+(?:detail|information|field))\s+(?:is\s+)?missing\b|\b(?:do\s+not|don't|no\s+need\s+to)\s+(?:provide|specify|tell)\b/iu;

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
    return `${result.fixtureId}:turn-${rubric.turnIndex}:${rubric.kind}:${rubric.field}`;
  }
  if (rubric.kind === 'turn_native_invocation_count') {
    return `${result.fixtureId}:turn-${rubric.turnIndex}:${rubric.toolName ?? 'all'}:${rubric.kind}`;
  }
  return `${result.fixtureId}:turn-${rubric.turnIndex}:${rubric.kind}`;
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
  if (rubric.kind === 'turn_memory_answer' || rubric.kind === 'turn_memory_selection') {
    return evaluateE2EMemoryProbeRubric(result, rubric);
  }
  const fixtureId = fixtureIdForRubric(result, rubric);
  if (!Number.isSafeInteger(rubric.turnIndex) || rubric.turnIndex < 0) {
    return { fixtureId, passed: false, detail: 'turn rubric index is invalid' };
  }
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

    case 'turn_clarification': {
      const fields: ReadonlyArray<E2EClarificationMissingField> = rubric.requiredMissingFields;
      if (
        !Array.isArray(fields) ||
        fields.length === 0 ||
        new Set(fields).size !== fields.length ||
        fields.some(
          (field) => !Object.prototype.hasOwnProperty.call(CLARIFICATION_FIELD_PATTERNS, field),
        )
      ) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} clarification expectation is invalid`,
        };
      }
      const response = turn.finalAssistant?.text.trim() ?? '';
      if (
        !response ||
        !CLARIFICATION_INTENT_PATTERN.test(response) ||
        NEGATED_CLARIFICATION_PATTERN.test(response)
      ) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} did not produce an affirmative clarification request`,
        };
      }
      const missingFields = fields.filter(
        (field: E2EClarificationMissingField) =>
          !CLARIFICATION_FIELD_PATTERNS[field].some((pattern: RegExp) => pattern.test(response)),
      );
      if (missingFields.length > 0) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} clarification omitted fields: ${missingFields.join(',')}`,
        };
      }
      return {
        fixtureId,
        passed: true,
        detail: `turn ${rubric.turnIndex} clarification requested fields: ${fields.join(',')}`,
      };
    }

    case 'turn_native_invocation_count': {
      if (
        !Number.isSafeInteger(rubric.expectedCount) ||
        rubric.expectedCount < 0 ||
        (rubric.toolName !== undefined &&
          (!rubric.toolName.trim() ||
            rubric.toolName !== rubric.toolName.trim() ||
            !NATIVE_TOOL_NAMES.has(rubric.toolName)))
      ) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} native invocation expectation is invalid`,
        };
      }
      const actualCount = rubric.toolName
        ? turn.native.invocations.filter((invocation) => invocation.toolName === rubric.toolName)
            .length
        : turn.native.invocations.length;
      if (actualCount !== rubric.expectedCount) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} native invocation count ${actualCount} (expected ${rubric.expectedCount})`,
        };
      }
      return { fixtureId, passed: true };
    }
  }
}
