import { executeToolDescribe } from '../../src/engine/tools/builtin-tool-describe';

describe('executeToolDescribe', () => {
  it('returns full contract for a built-in tool', async () => {
    const result = await executeToolDescribe({ name: 'memory_recall' });
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe('describe');
    expect(parsed.tool.name).toBe('memory_recall');
    expect(parsed.tool.source).toBe('built-in');
    expect(parsed.tool.schemaVersion).toBe('tool-catalog-entry-v1');
    expect(parsed.tool.schemaDigest).toMatch(/^schema-fnv1a32:[0-9a-f]{8}$/);
    expect(parsed.tool.contract?.capabilities).toContain('read');
    expect(parsed.tool.input_schema).toBeDefined();
    expect(parsed.tool.activation).toMatchObject({
      name: 'memory_recall',
      eligible: true,
      callableNow: true,
      reason: 'callable_now',
    });
  });

  it('returns structured error for unknown tools', async () => {
    const result = await executeToolDescribe({ name: 'not_a_real_tool_xyz' });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain('Unknown tool');
  });

  it('describes discoverable tools outside the current callable surface', async () => {
    const result = await executeToolDescribe(
      { name: 'memory_recall' },
      { availableToolNames: new Set(['tool_catalog']) },
    );
    const parsed = JSON.parse(result);

    expect(parsed.tool.name).toBe('memory_recall');
    expect(parsed.tool.activation).toMatchObject({
      name: 'memory_recall',
      eligible: true,
      callableNow: false,
    });
  });
});
