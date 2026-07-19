import {
  buildClarificationReviewBlock,
  CLARIFICATION_REVIEW_REQUIRED_CODE,
} from '../../src/engine/graph/clarificationReviewPolicy';
import type { ToolCallRecord } from '../../src/engine/loopDetection';

function call(name: string, status: ToolCallRecord['status'], result = '{}'): ToolCallRecord {
  return {
    name,
    arguments: '{}',
    timestamp: 1,
    status,
    result,
  };
}

describe('runtime integration clarification review', () => {
  it.each(['mcp__calendar__get_event', 'skill__travel__lookup'])(
    'requires one bounded reconsideration after completed %s work',
    (toolName) => {
      const block = buildClarificationReviewBlock({
        toolName: 'request_clarification',
        toolCallHistory: [call(toolName, 'completed')],
      });

      expect(JSON.parse(block ?? '{}')).toMatchObject({
        status: 'error',
        code: CLARIFICATION_REVIEW_REQUIRED_CODE,
        retryable: true,
        sideEffectApplied: false,
      });
    },
  );

  it('requires one bounded reconsideration when scoped discovery reports alternatives', () => {
    const catalogResult = JSON.stringify({
      mode: 'search',
      totalMatches: 0,
      recovery: {
        searchWithoutCategory: true,
        suggestedCategories: ['mcp', 'calendar'],
      },
    });

    const block = buildClarificationReviewBlock({
      toolName: 'request_clarification',
      toolCallHistory: [call('tool_catalog', 'completed', catalogResult)],
    });

    expect(JSON.parse(block ?? '{}')).toMatchObject({
      status: 'error',
      code: CLARIFICATION_REVIEW_REQUIRED_CODE,
      retryable: true,
      sideEffectApplied: false,
      recovery: {
        suggestedCategories: ['mcp', 'calendar'],
      },
    });
  });

  it('does not delay clarification after an empty catalog result with no viable alternative', () => {
    const catalogResult = JSON.stringify({
      mode: 'search',
      totalMatches: 0,
      recovery: { searchWithoutCategory: true, suggestedCategories: [] },
    });

    expect(
      buildClarificationReviewBlock({
        toolName: 'request_clarification',
        toolCallHistory: [call('tool_catalog', 'completed', catalogResult)],
      }),
    ).toBeUndefined();
  });

  it('does not reuse stale recovery after a later catalog search resolves it', () => {
    const emptyResult = JSON.stringify({
      mode: 'search',
      totalMatches: 0,
      recovery: { searchWithoutCategory: true, suggestedCategories: ['mcp'] },
    });
    const resolvedResult = JSON.stringify({
      mode: 'search',
      totalMatches: 1,
      tools: [{ name: 'mcp__calendar__list_events' }],
    });

    expect(
      buildClarificationReviewBlock({
        toolName: 'request_clarification',
        toolCallHistory: [
          call('tool_catalog', 'completed', emptyResult),
          call('tool_catalog', 'completed', resolvedResult),
        ],
      }),
    ).toBeUndefined();
  });

  it('does not delay an initial clarification or one following only failed integration work', () => {
    expect(
      buildClarificationReviewBlock({
        toolName: 'request_clarification',
        toolCallHistory: [],
      }),
    ).toBeUndefined();
    expect(
      buildClarificationReviewBlock({
        toolName: 'request_clarification',
        toolCallHistory: [call('mcp__calendar__get_event', 'failed')],
      }),
    ).toBeUndefined();
  });

  it('allows a genuine clarification after the bounded review has already occurred', () => {
    const priorBlock = JSON.stringify({ code: CLARIFICATION_REVIEW_REQUIRED_CODE });

    expect(
      buildClarificationReviewBlock({
        toolName: 'request_clarification',
        toolCallHistory: [
          call('mcp__calendar__get_event', 'completed'),
          call('request_clarification', 'failed', priorBlock),
        ],
      }),
    ).toBeUndefined();
  });

  it('does not affect any non-clarification tool', () => {
    expect(
      buildClarificationReviewBlock({
        toolName: 'mcp__calendar__get_event',
        toolCallHistory: [call('mcp__calendar__get_event', 'completed')],
      }),
    ).toBeUndefined();
  });
});
