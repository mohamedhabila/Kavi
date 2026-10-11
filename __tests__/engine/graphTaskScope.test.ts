import {
  resolveGraphTaskId,
  resolveGraphWorkingBlockScope,
} from '../../src/engine/graph/graphTaskScope';

describe('graphTaskScope', () => {
  it('scopes memory work to the workstream a worker run serves', () => {
    expect(resolveGraphTaskId('worker-chain')).toBe('worker-chain');
    expect(resolveGraphTaskId('  worker-chain  ')).toBe('worker-chain');
  });

  it('leaves a run without an active task unscoped', () => {
    expect(resolveGraphTaskId(undefined)).toBeUndefined();
    expect(resolveGraphTaskId(null)).toBeUndefined();
    expect(resolveGraphTaskId('   ')).toBeUndefined();
  });

  it('builds the working-block scope from the conversation and the active task', () => {
    expect(
      resolveGraphWorkingBlockScope({
        conversationId: 'conv-scope',
        graphState: { activeTaskId: 'worker-chain' },
      }),
    ).toEqual({ conversationId: 'conv-scope', threadId: 'conv-scope', taskId: 'worker-chain' });
    expect(resolveGraphWorkingBlockScope({ conversationId: 'conv-scope' })).toEqual({
      conversationId: 'conv-scope',
      threadId: 'conv-scope',
    });
  });
});
