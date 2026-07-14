import { filterToolsForMemoryPolicy } from '../../src/engine/tools/memoryPolicyToolAuthority';
import { BUILTIN_MEMORY_REGISTERED_TOOL_DEFINITIONS } from '../../src/engine/tools/builtin-definitions-memory';
import type { ToolDefinition } from '../../src/types/tool';

function tool(
  name: string,
  contract: NonNullable<ToolDefinition['contract']>,
): ToolDefinition {
  return {
    name,
    description: name,
    input_schema: { type: 'object', properties: {} },
    contract,
  };
}

describe('memory-policy tool authority', () => {
  it('preserves the complete tool inventory while long-term memory is enabled', () => {
    expect(
      filterToolsForMemoryPolicy(BUILTIN_MEMORY_REGISTERED_TOOL_DEFINITIONS, true),
    ).toEqual(BUILTIN_MEMORY_REGISTERED_TOOL_DEFINITIONS);
  });

  it('removes non-erasure memory capabilities while preserving unrelated tools', () => {
    const unrelated = tool('calendario_日程', {
      category: 'calendar',
      capabilities: ['read'],
      resourceKinds: ['calendar'],
      sideEffects: ['none'],
    });

    const filtered = filterToolsForMemoryPolicy(
      [...BUILTIN_MEMORY_REGISTERED_TOOL_DEFINITIONS, unrelated],
      false,
    );

    expect(filtered.map((definition) => definition.name).sort()).toEqual([
      'calendario_日程',
      'memory_forget',
    ]);
  });

  it('uses typed contracts rather than names or language to identify memory tools', () => {
    const memoryTool = tool('記憶_حفظ', {
      category: 'custom',
      capabilities: ['write'],
      resourceKinds: ['memory'],
      sideEffects: ['local_artifact'],
    });
    const similarlyNamedNonMemoryTool = tool('memory_like_name', {
      category: 'custom',
      capabilities: ['read'],
      resourceKinds: ['device'],
      sideEffects: ['none'],
    });

    expect(
      filterToolsForMemoryPolicy([memoryTool, similarlyNamedNonMemoryTool], false).map(
        (definition) => definition.name,
      ),
    ).toEqual(['memory_like_name']);
  });

  it('keeps only approval-gated destructive memory tools available for erasure', () => {
    const approvedErasure = tool('eliminar_datos', {
      category: 'custom',
      capabilities: ['delete'],
      resourceKinds: ['memory'],
      sideEffects: ['destructive'],
      riskHints: ['requires_approval'],
    });
    const unapprovedDestructiveTool = tool('erase_without_consent', {
      category: 'custom',
      capabilities: ['delete'],
      resourceKinds: ['memory'],
      sideEffects: ['destructive'],
    });

    expect(
      filterToolsForMemoryPolicy([approvedErasure, unapprovedDestructiveTool], false).map(
        (definition) => definition.name,
      ),
    ).toEqual(['eliminar_datos']);
  });

  it('does not infer erasure authority from destructive risk alone', () => {
    const destructiveRewrite = tool('rebuild_store', {
      category: 'custom',
      capabilities: ['write'],
      resourceKinds: ['memory'],
      sideEffects: ['destructive'],
      riskHints: ['requires_approval'],
    });

    expect(filterToolsForMemoryPolicy([destructiveRewrite], false)).toEqual([]);
  });
});
