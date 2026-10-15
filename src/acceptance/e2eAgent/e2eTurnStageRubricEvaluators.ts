import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import { ALL_NATIVE_TOOL_DEFINITIONS } from '../../engine/tools/native/definitions';
import {
  descriptorForToolName,
  descriptorHasProducerEffect,
} from '../../engine/tools/toolLifecycleSemantics';
import {
  isRequestClarificationSemanticRole,
  isRequestInformationKey,
  parseRequestClarificationToolResult,
  REQUEST_CLARIFICATION_TOOL_NAME,
} from '../../services/agents/requestClarification';
import { evaluateE2EMemoryProbeRubric } from './e2eMemoryProbeRubricEvaluators';
import type {
  E2EClarificationMissingInformation,
  E2ERubric,
  E2EScenarioResult,
  E2EScenarioTurnTrace,
} from './types';

type E2ETurnStageRubric = Extract<
  E2ERubric,
  {
    kind:
      | 'turn_completion'
      | 'turn_lifecycle_boundary'
      | 'turn_final_response_token'
      | 'turn_clarification'
      | 'turn_native_invocation_count'
      | 'turn_tool_call_count'
      | 'turn_memory_answer'
      | 'turn_memory_selection';
  }
>;

type E2ETurnCompletionRubric = Extract<E2ERubric, { kind: 'turn_completion' }>;
const TURN_COMPLETION_FIELDS = new Set(['execution', 'final_response', 'agent_run']);
const NATIVE_TOOL_NAMES = new Set(ALL_NATIVE_TOOL_DEFINITIONS.map((tool) => tool.name));

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
    const tools = rubric.toolNames?.join('+') ?? rubric.toolName ?? 'all';
    return `${result.fixtureId}:turn-${rubric.turnIndex}:${tools}:${rubric.kind}`;
  }
  if (rubric.kind === 'turn_tool_call_count') {
    return `${result.fixtureId}:turn-${rubric.turnIndex}:${rubric.scope}:${rubric.kind}`;
  }
  return `${result.fixtureId}:turn-${rubric.turnIndex}:${rubric.kind}`;
}

function hasValidCompletionExpectation(rubric: E2ETurnCompletionRubric): boolean {
  if (!TURN_COMPLETION_FIELDS.has(rubric.field)) {
    return false;
  }
  return typeof rubric.expected === 'boolean';
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

    case 'turn_lifecycle_boundary': {
      const lifecycle = turn.lifecycleBefore;
      const observed =
        lifecycle?.boundary === 'app_relaunch'
          ? lifecycle.chatStore === 'rehydrated' && lifecycle.memoryStore === 'reopened'
          : lifecycle?.boundary === 'context_reset'
            ? lifecycle.chatStore === 'context_archived' &&
              lifecycle.memoryStore === 'shared_global' &&
              Number.isSafeInteger(lifecycle.previousLiveMessageCount) &&
              lifecycle.previousLiveMessageCount > 0 &&
              lifecycle.liveMessageCountAfter === 0
            : false;
      if (!lifecycle || lifecycle.boundary !== rubric.boundary || !observed) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} ${rubric.boundary} lifecycle boundary not observed`,
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
      const requirements: ReadonlyArray<E2EClarificationMissingInformation> =
        rubric.requiredMissingInformation;
      if (
        !Array.isArray(requirements) ||
        requirements.length === 0 ||
        new Set(
          requirements.map(
            (requirement) => `${requirement.semanticRole}:${requirement.key ?? '*'}`,
          ),
        ).size !== requirements.length ||
        requirements.some(
          (requirement) =>
            !requirement ||
            typeof requirement !== 'object' ||
            !isRequestClarificationSemanticRole(requirement.semanticRole) ||
            (requirement.key !== undefined && !isRequestInformationKey(requirement.key)),
        )
      ) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} clarification expectation is invalid`,
        };
      }
      // The clarification the turn recorded: a call the tool refused and the model then
      // repaired does not count against it.
      const recordedClarifications = turn.toolCalls
        .filter((call) => call.name === REQUEST_CLARIFICATION_TOOL_NAME)
        .map((call) =>
          turn.toolResults.find(
            (result) =>
              result.toolCallId === call.id &&
              result.name === REQUEST_CLARIFICATION_TOOL_NAME &&
              !result.isError,
          ),
        )
        .map((result) => (result ? parseRequestClarificationToolResult(result.content) : undefined))
        .filter((parsed) => parsed !== undefined);
      const clarification = recordedClarifications[recordedClarifications.length - 1];
      if (!clarification) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} did not record a valid structured clarification request`,
        };
      }
      const missingRequirements = requirements.filter(
        (requirement) =>
          !clarification.requiredInformation.some(
            (entry) =>
              entry.semanticRole === requirement.semanticRole &&
              (requirement.key === undefined || entry.key === requirement.key),
          ),
      );
      if (missingRequirements.length > 0) {
        return {
          fixtureId,
          passed: false,
          detail:
            `turn ${rubric.turnIndex} clarification omitted information: ` +
            missingRequirements
              .map((requirement) => `${requirement.semanticRole}:${requirement.key ?? '*'}`)
              .join(','),
        };
      }
      const response = turn.finalAssistant?.text.trim() ?? '';
      if (!response || !response.includes(clarification.question)) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} did not deliver the registered clarification question`,
        };
      }
      return {
        fixtureId,
        passed: true,
        detail:
          `turn ${rubric.turnIndex} clarification requested information: ` +
          requirements
            .map((requirement) => `${requirement.semanticRole}:${requirement.key ?? '*'}`)
            .join(','),
      };
    }

    case 'turn_native_invocation_count': {
      const toolNames =
        rubric.toolNames ?? (rubric.toolName !== undefined ? [rubric.toolName] : undefined);
      if (
        !Number.isSafeInteger(rubric.expectedCount) ||
        rubric.expectedCount < 0 ||
        (rubric.toolNames !== undefined && rubric.toolName !== undefined) ||
        (toolNames !== undefined &&
          (toolNames.length === 0 ||
            toolNames.some(
              (toolName) =>
                !toolName.trim() ||
                toolName !== toolName.trim() ||
                !NATIVE_TOOL_NAMES.has(toolName),
            )))
      ) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} native invocation expectation is invalid`,
        };
      }
      const actualCount = toolNames
        ? turn.native.invocations.filter((invocation) => toolNames.includes(invocation.toolName))
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

    case 'turn_tool_call_count': {
      if (
        !Number.isSafeInteger(rubric.expectedCount) ||
        rubric.expectedCount < 0 ||
        (rubric.scope !== 'all' && rubric.scope !== 'side_effectful')
      ) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} tool call expectation is invalid`,
        };
      }
      const actualCount =
        rubric.scope === 'all'
          ? turn.toolCalls.length
          : turn.toolCalls.filter((call) =>
              descriptorHasProducerEffect(descriptorForToolName(call.name)),
            ).length;
      if (actualCount !== rubric.expectedCount) {
        return {
          fixtureId,
          passed: false,
          detail: `turn ${rubric.turnIndex} ${rubric.scope} tool call count ${actualCount} (expected ${rubric.expectedCount})`,
        };
      }
      return { fixtureId, passed: true };
    }
  }
}
