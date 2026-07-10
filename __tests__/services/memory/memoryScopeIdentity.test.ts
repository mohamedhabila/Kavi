import {
  isExactMemoryScopeId,
  requireMemoryAccessScopeIdentity,
} from '../../../src/services/memory/memoryScopeIdentity';

describe('memory scope identity', () => {
  it.each(['', ' leading', 'trailing ', 'two words', 'line\nbreak', 'x'.repeat(161)])(
    'rejects a non-exact identifier %j',
    (value) => {
      expect(isExactMemoryScopeId(value)).toBe(false);
    },
  );

  it('requires every identity field and an explicit nullable task', () => {
    const scope = {
      memoryOwnerId: 'owner-1',
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      personaId: 'persona-1',
      taskId: null,
    };
    expect(requireMemoryAccessScopeIdentity(scope)).toEqual(scope);
    expect(() =>
      requireMemoryAccessScopeIdentity({
        ...scope,
        taskId: ' invalid ',
      }),
    ).toThrow('memory_scope_task_id_invalid');
    const { taskId: _taskId, ...missingTask } = scope;
    expect(() => requireMemoryAccessScopeIdentity(missingTask as typeof scope)).toThrow(
      'memory_scope_task_id_invalid',
    );
  });
});
