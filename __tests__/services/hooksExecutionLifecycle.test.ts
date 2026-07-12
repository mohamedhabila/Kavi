import {
  abortAllHookExecutions,
  registerHookExecution,
} from '../../src/services/hooks/executionLifecycle';

describe('hook execution lifecycle', () => {
  afterEach(() => {
    abortAllHookExecutions();
  });

  it('propagates a parent scheduled abort to hook work', () => {
    const parent = new AbortController();
    const hook = registerHookExecution(parent);

    parent.abort(new Error('scheduled execution stopped'));

    expect(hook.controller.signal).toMatchObject({
      aborted: true,
      reason: parent.signal.reason,
    });
    hook.unregister();
  });

  it('aborts independently started post-terminal hook work on background', () => {
    const first = registerHookExecution();
    const second = registerHookExecution();

    expect(abortAllHookExecutions()).toBe(2);
    expect(first.controller.signal.aborted).toBe(true);
    expect(second.controller.signal.aborted).toBe(true);

    first.unregister();
    second.unregister();
    expect(abortAllHookExecutions()).toBe(0);
  });
});
