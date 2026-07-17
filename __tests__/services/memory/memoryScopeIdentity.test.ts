import {
  isExactMemoryScopeId,
  requireExactMemoryScopeId,
  requireMemoryAccessScopeIdentity,
  resolveCodeOwnedMemoryConversationId,
  resolveCodeOwnedMemoryPersonaId,
  resolveCodeOwnedMemoryTaskId,
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

  it('defaults code-owned scope only when the optional identity is absent', () => {
    expect(resolveCodeOwnedMemoryConversationId(undefined, 'conversation-1')).toBe(
      'conversation-1',
    );
    expect(resolveCodeOwnedMemoryTaskId(undefined)).toBeNull();
    expect(resolveCodeOwnedMemoryPersonaId(undefined)).toBe('default');
    expect(resolveCodeOwnedMemoryPersonaId('super-agent')).toBe('default');
    expect(resolveCodeOwnedMemoryPersonaId('coder')).toBe('coder');

    expect(() => resolveCodeOwnedMemoryConversationId('', 'conversation-1')).toThrow(
      'memory_scope_conversation_id_invalid',
    );
    expect(() => resolveCodeOwnedMemoryTaskId(' task-1')).toThrow('memory_scope_task_id_invalid');
    expect(() => resolveCodeOwnedMemoryPersonaId('')).toThrow('memory_scope_persona_id_invalid');
  });

  it('exposes a strict reusable scope assertion with caller-owned error codes', () => {
    expect(requireExactMemoryScopeId('scope-1', 'scope_invalid')).toBe('scope-1');
    expect(() => requireExactMemoryScopeId(' scope-1', 'scope_invalid')).toThrow('scope_invalid');
  });
});
