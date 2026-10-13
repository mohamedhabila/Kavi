import { isToolAllowedBySandbox } from '../../src/services/agents/subAgentToolAccess';

describe('safe-only worker tool access', () => {
  it('lets a worker read browser diagnostics but not write workspace files', () => {
    expect(isToolAllowedBySandbox('browser_inspect', 'safe-only')).toBe(true);
    expect(isToolAllowedBySandbox('write_file', 'safe-only')).toBe(false);
  });
});
