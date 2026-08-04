// ---------------------------------------------------------------------------
// Kavi — Goal infeasibility exhaustion gate
// ---------------------------------------------------------------------------
// Surrender must be reachable but earned. These tests pin both halves: a claim
// backed by genuinely distinct exhausted approaches is accepted, and a claim
// backed by repetition or an untried path is refused with the concrete next step.
// ---------------------------------------------------------------------------

import {
  assessGoalInfeasibilityClaim,
  MINIMUM_DISTINCT_INFEASIBILITY_ATTEMPTS,
} from '../../src/engine/goals/infeasibility';
import type { ToolCallRecord } from '../../src/engine/loopDetection';

function call(
  name: string,
  args: string,
  status: 'completed' | 'failed' = 'failed',
): ToolCallRecord {
  return { name, arguments: args, status, timestamp: 1 };
}

describe('goal infeasibility exhaustion gate', () => {
  it('accepts a claim once distinct approaches are exhausted', () => {
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: [call('web_search', '{"q":"a"}'), call('web_fetch', '{"url":"b"}')],
      capabilityToolNames: ['web_search', 'web_fetch'],
    });

    expect(assessment.accepted).toBe(true);
  });

  it('refuses a claim while a capability path is untried, and names it', () => {
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: [call('web_search', '{"q":"a"}'), call('web_search', '{"q":"b"}')],
      capabilityToolNames: ['web_search', 'web_fetch'],
    });

    expect(assessment.accepted).toBe(false);
    if (assessment.accepted) throw new Error('unreachable');
    expect(assessment.code).toBe('untried_capability_path');
    expect(assessment.untriedToolNames).toEqual(['web_fetch']);
    expect(assessment.message).toContain('web_fetch');
  });

  it('does not count repeating one call with identical arguments as trying harder', () => {
    const repeated = Array.from({ length: 13 }, () => call('update_goals', '{"action":"block"}'));
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: repeated,
      capabilityToolNames: [],
    });

    expect(assessment.accepted).toBe(false);
    if (assessment.accepted) throw new Error('unreachable');
    expect(assessment.code).toBe('insufficient_distinct_attempts');
    expect(assessment.distinctFailedAttempts).toBe(1);
  });

  it('counts differing arguments on the same tool as distinct approaches', () => {
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: [call('web_search', '{"q":"a"}'), call('web_search', '{"q":"b"}')],
      capabilityToolNames: [],
    });

    expect(assessment.accepted).toBe(true);
  });

  it('ignores successful calls when counting failed approaches', () => {
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: [
        call('web_search', '{"q":"a"}', 'completed'),
        call('web_fetch', '{"url":"b"}', 'completed'),
      ],
      capabilityToolNames: [],
    });

    expect(assessment.accepted).toBe(false);
    if (assessment.accepted) throw new Error('unreachable');
    expect(assessment.distinctFailedAttempts).toBe(0);
  });

  it('requires asking the user before abandoning when clarification is available', () => {
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: [call('web_search', '{"q":"a"}'), call('web_fetch', '{"url":"b"}')],
      capabilityToolNames: ['web_search', 'web_fetch'],
      clarificationToolName: 'request_clarification',
    });

    expect(assessment.accepted).toBe(false);
    if (assessment.accepted) throw new Error('unreachable');
    expect(assessment.code).toBe('untried_clarification');
    expect(assessment.message).toContain('request_clarification');
  });

  it('accepts once clarification has also been exhausted', () => {
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: [
        call('web_search', '{"q":"a"}'),
        call('web_fetch', '{"url":"b"}'),
        call('request_clarification', '{"question":"which source?"}'),
      ],
      capabilityToolNames: ['web_search', 'web_fetch'],
      clarificationToolName: 'request_clarification',
    });

    expect(assessment.accepted).toBe(true);
  });

  it('reports an untried path before an attempt shortfall so the next step is concrete', () => {
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: [],
      capabilityToolNames: ['write_file'],
    });

    expect(assessment.accepted).toBe(false);
    if (assessment.accepted) throw new Error('unreachable');
    expect(assessment.code).toBe('untried_capability_path');
  });

  it('refuses an unearned claim when nothing has been attempted at all', () => {
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: [],
      capabilityToolNames: [],
    });

    expect(assessment.accepted).toBe(false);
  });

  it('treats tool names case-insensitively when matching untried paths', () => {
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: [call('Web_Search', '{"q":"a"}'), call('WEB_FETCH', '{"url":"b"}')],
      capabilityToolNames: ['web_search', 'web_fetch'],
    });

    expect(assessment.accepted).toBe(true);
  });

  it('honours a stricter configured attempt minimum', () => {
    const assessment = assessGoalInfeasibilityClaim({
      toolCallHistory: [call('web_search', '{"q":"a"}'), call('web_search', '{"q":"b"}')],
      capabilityToolNames: [],
      minimumDistinctAttempts: MINIMUM_DISTINCT_INFEASIBILITY_ATTEMPTS + 2,
    });

    expect(assessment.accepted).toBe(false);
  });
});
