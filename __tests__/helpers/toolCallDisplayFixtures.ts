// Shared fixtures for the ToolCallDisplay test suites. Extracted when the original
// single file crossed the repository's 700-line maintainability limit; duplicating
// this setup per file would have been the worse answer.

import type { ToolCall } from '../../src/types/message';

export const makeToolCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  id: 'tc1',
  name: 'read_file',
  arguments: '{"path":"test.txt"}',
  status: 'completed',
  ...overrides,
});
