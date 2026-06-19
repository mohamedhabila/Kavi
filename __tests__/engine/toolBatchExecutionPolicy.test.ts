import {
  isParallelizableToolName,
  shouldExecuteToolBatchInParallel,
} from '../../src/engine/graph/toolBatchExecutionPolicy';
import { createGoal } from '../../src/engine/goals/types';
import type { ToolDefinition } from '../../src/types/tool';

describe('tool batch execution policy', () => {
  it('runs independent read, wait, and compute tools in parallel batches', () => {
    expect(
      shouldExecuteToolBatchInParallel([
        { name: 'read_file' },
        { name: 'sessions_wait' },
        { name: 'python' },
      ]),
    ).toBe(true);
  });

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

  it('treats unknown tools as non-parallelizable', () => {
    expect(isParallelizableToolName('unknown_custom_tool')).toBe(false);
  });

  it('forces sequential batches when active goals declare multiple capabilities', () => {
    const goals = [
      createGoal({
        id: 'calendar-workflow',
        title: 'calendar-chain',
        status: 'active',
        requiredCapabilities: ['discover', 'read', 'verify'],
      }),
    ];
    expect(
      shouldExecuteToolBatchInParallel(
        [{ name: 'calendar_list' }, { name: 'calendar_events' }],
        goals,
      ),
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
      shouldExecuteToolBatchInParallel(
        [{ name: 'source_read' }, { name: 'consumer_read' }],
        undefined,
        tools,
      ),
    ).toBe(false);
  });
});
