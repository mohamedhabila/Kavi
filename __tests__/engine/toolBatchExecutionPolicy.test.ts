import { shouldExecuteToolBatchInParallel } from '../../src/engine/graph/toolBatchExecutionPolicy';
import type { ToolDefinition } from '../../src/types/tool';

describe('tool batch execution policy', () => {
  it('runs independent read and wait tools in parallel batches', () => {
    expect(
      shouldExecuteToolBatchInParallel([{ name: 'read_file' }, { name: 'sessions_wait' }]),
    ).toBe(true);
  });

  it.each(['javascript', 'python'])(
    'does not parallelize potentially mutating %s execution',
    (toolName) => {
      expect(shouldExecuteToolBatchInParallel([{ name: 'read_file' }, { name: toolName }])).toBe(
        false,
      );
    },
  );

  it('does not parallelize single tool calls', () => {
    expect(shouldExecuteToolBatchInParallel([{ name: 'read_file' }])).toBe(false);
  });

  it('does not parallelize batches with local mutations', () => {
    expect(shouldExecuteToolBatchInParallel([{ name: 'read_file' }, { name: 'write_file' }])).toBe(
      false,
    );
  });

  it('does not parallelize batches with session producers', () => {
    expect(
      shouldExecuteToolBatchInParallel([{ name: 'sessions_spawn' }, { name: 'sessions_wait' }]),
    ).toBe(false);
  });

  it('does not parallelize canonical native tools with permission evidence dependencies', () => {
    expect(
      shouldExecuteToolBatchInParallel([
        { name: 'device_permissions' },
        { name: 'location_current' },
      ]),
    ).toBe(false);
  });

  it('does not parallelize read-only tools with structural producer-consumer dependencies', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'source_read',
        description: 'Read source evidence.',
        input_schema: { type: 'object', properties: {} },
        contract: {
          category: 'fixture',
          capabilities: ['read', 'verify'],
          resourceKinds: ['unknown'],
          sideEffects: ['none'],
          riskHints: ['read_only'],
          produces: [{ kind: 'resource_id' }],
        },
      },
      {
        name: 'consumer_read',
        description: 'Read dependent evidence.',
        input_schema: { type: 'object', properties: {} },
        contract: {
          category: 'fixture',
          capabilities: ['read', 'verify'],
          resourceKinds: ['unknown'],
          sideEffects: ['none'],
          riskHints: ['read_only'],
          consumes: [{ kind: 'resource_id' }],
        },
      },
    ];

    expect(
      shouldExecuteToolBatchInParallel([{ name: 'source_read' }, { name: 'consumer_read' }], tools),
    ).toBe(false);
  });
});
