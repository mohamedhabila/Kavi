import { compactJson } from '../../benchmarks/longmemeval_v2/runtimeJsonCompaction';

describe('LongMemEval runtime JSON compaction', () => {
  it('keeps oversized payloads parseable while preserving scalar fields', () => {
    const serialized = compactJson(
      {
        trajectory_id: 'qrun-json-safe',
        state_index: 7,
        action: "tap('qcontrol')",
        accessibility_tree: 'qnode '.repeat(20_000),
      },
      3_000,
    );

    expect(serialized.length).toBeLessThanOrEqual(3_000);
    const parsed = JSON.parse(serialized);
    expect(parsed.trajectory_id).toBe('qrun-json-safe');
    expect(parsed.state_index).toBe(7);
    expect(parsed.action).toBe("tap('qcontrol')");
    expect(parsed.accessibility_tree).toContain('qnode');
  });

  it('compacts nested long strings without slicing through JSON syntax', () => {
    const serialized = compactJson(
      {
        id: 'qnested-json-safe',
        states: [
          {
            url: 'https://mobile.example.test',
            thought: 'qthought '.repeat(10_000),
          },
        ],
      },
      1_200,
    );

    expect(serialized.length).toBeLessThanOrEqual(1_200);
    const parsed = JSON.parse(serialized);
    expect(parsed.id).toBe('qnested-json-safe');
    expect(parsed.states[0].url).toBe('https://mobile.example.test');
    expect(parsed.states[0].thought).toContain('qthought');
  });
});
