import { createScheduledJobRetryPolicy } from '../../src/services/scheduler/jobExecutorRetryPolicy';

describe('scheduled job retry policy', () => {
  it('does not retry deterministic provider request failures', () => {
    const policy = createScheduledJobRetryPolicy();
    const error = new Error(
      'LLM API error 400 invalid_request_error: tool_result blocks must follow tool_use blocks',
    );

    expect(policy.isProviderFailureNonRetryable(error)).toBe(true);
  });

  it('allows transient provider failures to retry after read-only tool activity', () => {
    const policy = createScheduledJobRetryPolicy();
    policy.recordToolActivity('web_fetch');

    expect(policy.hasObservedUnsafeToolActivity()).toBe(false);
    expect(policy.isProviderFailureNonRetryable(new Error('provider disconnected'))).toBe(false);
  });

  it('does not retry transient provider failures after effectful tool activity', () => {
    const policy = createScheduledJobRetryPolicy();
    policy.recordToolActivity('calendar_create_event');

    expect(policy.hasObservedUnsafeToolActivity()).toBe(true);
    expect(policy.isProviderFailureNonRetryable(new Error('provider disconnected'))).toBe(true);
  });

  it('allows a lifecycle cancellation to retry before any unsafe activity', () => {
    const lifecycle = new AbortController();
    const policy = createScheduledJobRetryPolicy(lifecycle.signal);

    lifecycle.abort();
    policy.recordControlGraphStatus('cancelled');

    expect(policy.isTerminalFailureNonRetryable(true)).toBe(false);
  });

  it('keeps a cancellation nonretryable when the scheduler did not abort it', () => {
    const policy = createScheduledJobRetryPolicy(new AbortController().signal);

    policy.recordControlGraphStatus('cancelled');

    expect(policy.isTerminalFailureNonRetryable(true)).toBe(true);
  });

  it('does not retry a lifecycle cancellation after unsafe activity', () => {
    const lifecycle = new AbortController();
    const policy = createScheduledJobRetryPolicy(lifecycle.signal);

    policy.recordToolActivity('calendar_create_event');
    lifecycle.abort();
    policy.recordControlGraphStatus('cancelled');

    expect(policy.isTerminalFailureNonRetryable(true)).toBe(true);
  });
});
