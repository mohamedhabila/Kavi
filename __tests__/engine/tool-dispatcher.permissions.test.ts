import {
  CONV_ID,
  setToolPermissionAllowed,
  setupToolDispatcherHarness,
  type ToolDispatcherHarness,
} from '../helpers/toolDispatcherHarness';

let executeTool: ToolDispatcherHarness['executeTool'];

beforeEach(() => {
  const harness = setupToolDispatcherHarness();
  executeTool = harness.executeTool;
});

describe('executeTool — permission check', () => {
  it('blocks denied tools', async () => {
    setToolPermissionAllowed(false);
    const result = await executeTool('read_file', '{"path":"test"}', CONV_ID);
    expect(result).toContain('not allowed');
  });
});
