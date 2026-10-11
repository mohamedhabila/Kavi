import { boundMemoryText, memoryTextLength } from '../../../../src/services/memory/core/memoryText';

const FAMILY = '👨‍👩‍👧‍👦'; // one grapheme, seven code points

describe('memory text bounds', () => {
  it('counts code points, the unit SQLite and JSON Schema count', () => {
    expect(memoryTextLength('abc')).toBe(3);
    expect(memoryTextLength('😀')).toBe(1);
    expect(memoryTextLength(FAMILY)).toBe(7);
    expect(memoryTextLength('سلام')).toBe(4);
  });

  it('keeps text that fits and cuts longer text at a grapheme boundary', () => {
    expect(boundMemoryText('short', 5)).toBe('short');

    const cut = boundMemoryText(FAMILY.repeat(3), 16);

    expect(cut).toBe(`${FAMILY}${FAMILY}…`);
    expect(memoryTextLength(cut)).toBeLessThanOrEqual(16);
  });
});
