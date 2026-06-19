import { isToolResultErrorLike } from '../../src/utils/toolResultErrors';

describe('isToolResultErrorLike', () => {
  it('detects plain Error-prefixed results', () => {
    expect(isToolResultErrorLike('Error: ENOENT')).toBe(true);
    expect(isToolResultErrorLike('Error executing github/workflow_runs: HTTP 403')).toBe(true);
  });

  it('detects JSON error payloads', () => {
    expect(
      isToolResultErrorLike(JSON.stringify({ status: 'error', error: 'Missing surface' })),
    ).toBe(true);
  });

  it('ignores successful JSON payloads', () => {
    expect(isToolResultErrorLike(JSON.stringify({ status: 'ok', value: 42 }))).toBe(false);
  });

  it('ignores plain non-error text', () => {
    expect(isToolResultErrorLike('Completed successfully')).toBe(false);
  });

  it('detects preflight tool-filter blocked messages', () => {
    expect(
      isToolResultErrorLike('Tool "update_goals" is not allowed in this context.'),
    ).toBe(true);
    expect(isToolResultErrorLike('Tool "unknown_tool" is not registered.')).toBe(true);
  });
});
