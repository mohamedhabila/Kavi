import {
  buildClarificationReviewBlock,
  CLARIFICATION_REVIEW_REQUIRED_CODE,
} from '../../src/engine/graph/clarificationReviewPolicy';
import type { ToolCallRecord } from '../../src/engine/loopDetection';

function call(
  name: string,
  status: ToolCallRecord['status'],
  result = '{}',
): ToolCallRecord {
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
