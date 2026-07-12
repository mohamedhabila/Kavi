import { selectIndexedRecallLexicalUnits } from '../../../src/services/memory/factRecallCandidateUnits';

describe('selectIndexedRecallLexicalUnits', () => {
  it('preserves a short query without consulting stored memory', () => {
    expect(selectIndexedRecallLexicalUnits(['alpha', 'beta', 'alpha'], [])).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('samples the head, middle, and tail of a long query deterministically', () => {
    const units = Array.from({ length: 30 }, (_, index) => `unit${index}`);

    const selected = selectIndexedRecallLexicalUnits(units, []);

    expect(selected).toHaveLength(24);
    expect(selected[0]).toBe('unit0');
    expect(selected).toContain('unit15');
    expect(selected.at(-1)).toBe('unit29');
    expect(selectIndexedRecallLexicalUnits(units, [])).toEqual(selected);
  });

  it('keeps every explicit anchor when they fit, then samples non-anchors', () => {
    const units = Array.from({ length: 40 }, (_, index) => `unit${index}`);
    const anchors = ['unit2', 'unit20', 'unit38'];

    const selected = selectIndexedRecallLexicalUnits(units, anchors);

    expect(selected.slice(0, anchors.length)).toEqual(anchors);
    expect(selected).toHaveLength(24);
    expect(selected.at(-1)).toBe('unit39');
  });

  it('evenly bounds an anchor set that alone exceeds the query budget', () => {
    const units = Array.from({ length: 40 }, (_, index) => `anchor${index}`);

    const selected = selectIndexedRecallLexicalUnits(units, units);

    expect(selected).toHaveLength(24);
    expect(selected[0]).toBe('anchor0');
    expect(selected.at(-1)).toBe('anchor39');
  });

  it('uses the tail when anchors leave exactly one non-anchor slot', () => {
    const anchors = Array.from({ length: 23 }, (_, index) => `anchor${index}`);
    const units = [...anchors, 'early', 'middle', 'tail'];

    expect(selectIndexedRecallLexicalUnits(units, anchors)).toEqual([...anchors, 'tail']);
  });
});
