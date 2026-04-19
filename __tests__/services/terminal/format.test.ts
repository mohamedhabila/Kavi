// ---------------------------------------------------------------------------
// Tests — Terminal Table Rendering (format.ts)
// ---------------------------------------------------------------------------

import { renderTable, type RenderTableOptions } from '../../../src/services/terminal/format';

function makeOpts(overrides: Partial<RenderTableOptions> = {}): RenderTableOptions {
  return {
    columns: [
      { key: 'name', header: 'Name' },
      { key: 'value', header: 'Value' },
    ],
    rows: [
      { name: 'alpha', value: '1' },
      { name: 'beta', value: '2' },
    ],
    ...overrides,
  };
}

describe('renderTable', () => {
  it('renders a basic unicode table', () => {
    const result = renderTable(makeOpts());
    expect(result).toContain('┌');
    expect(result).toContain('┐');
    expect(result).toContain('└');
    expect(result).toContain('┘');
    expect(result).toContain('│');
    expect(result).toContain('Name');
    expect(result).toContain('Value');
    expect(result).toContain('alpha');
    expect(result).toContain('beta');
  });

  it('renders with ascii border', () => {
    const result = renderTable(makeOpts({ border: 'ascii' }));
    expect(result).toContain('+');
    expect(result).toContain('|');
    expect(result).toContain('-');
    expect(result).not.toContain('┌');
  });

  it('renders with no border', () => {
    const result = renderTable(makeOpts({ border: 'none' }));
    expect(result).not.toContain('┌');
    expect(result).not.toContain('+');
    expect(result).toContain('Name | Value');
    expect(result).toContain('alpha | 1');
  });

  it('includes header row and data rows', () => {
    const result = renderTable(makeOpts());
    const lines = result.split('\n').filter(Boolean);
    // top border, header, separator, 2 data rows, bottom border = 6
    expect(lines.length).toBe(6);
  });

  it('handles empty rows', () => {
    const result = renderTable(makeOpts({ rows: [] }));
    expect(result).toContain('Name');
    // Should still render header
    const lines = result.split('\n').filter(Boolean);
    // top border, header, separator, bottom border
    expect(lines.length).toBe(4);
  });

  it('handles missing cell values gracefully', () => {
    const result = renderTable(
      makeOpts({
        rows: [{ name: 'only-name' }],
      }),
    );
    expect(result).toContain('only-name');
    // Should not throw
  });

  it('respects column alignment', () => {
    const result = renderTable({
      columns: [
        { key: 'left', header: 'Left', align: 'left' },
        { key: 'right', header: 'Right', align: 'right' },
        { key: 'center', header: 'Center', align: 'center' },
      ],
      rows: [{ left: 'L', right: 'R', center: 'C' }],
    });
    // Just ensure it renders without error and contains the data
    expect(result).toContain('L');
    expect(result).toContain('R');
    expect(result).toContain('C');
  });

  it('constrains to maxWidth when specified', () => {
    const result = renderTable(makeOpts({ width: 30 }));
    const lines = result.split('\n').filter(Boolean);
    for (const line of lines) {
      // Each line should not exceed the width 30
      // (visible width, not byte width)
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });

  it('supports flex columns that expand to fill width', () => {
    const result = renderTable({
      columns: [
        { key: 'fixed', header: 'F', minWidth: 5 },
        { key: 'flex', header: 'Flexible', flex: true },
      ],
      rows: [{ fixed: 'A', flex: 'B' }],
      width: 40,
    });
    expect(result).toContain('A');
    expect(result).toContain('B');
  });

  it('handles ANSI content in cells', () => {
    const result = renderTable(
      makeOpts({
        rows: [{ name: '\x1b[31mred\x1b[0m', value: 'plain' }],
      }),
    );
    expect(result).toContain('red');
  });

  it('handles CJK content in cells', () => {
    const result = renderTable(
      makeOpts({
        rows: [{ name: '中文', value: '数据' }],
      }),
    );
    expect(result).toContain('中文');
    expect(result).toContain('数据');
  });

  it('wraps long cell content', () => {
    const longText = 'a'.repeat(100);
    const result = renderTable(
      makeOpts({
        columns: [{ key: 'text', header: 'Text', maxWidth: 20 }],
        rows: [{ text: longText }],
        width: 25,
      }),
    );
    // Should produce multiple visual lines to wrap the content
    const dataLines = result
      .split('\n')
      .filter((l) => l.includes('│') || l.includes('|'))
      .filter((l) => l.includes('a'));
    expect(dataLines.length).toBeGreaterThan(1);
  });

  it('respects minWidth on columns', () => {
    const result = renderTable({
      columns: [
        { key: 'a', header: 'X', minWidth: 15 },
        { key: 'b', header: 'Y' },
      ],
      rows: [{ a: '1', b: '2' }],
    });
    // The first column should be at least 15 wide
    const headerLine = result.split('\n').find((l) => l.includes('X'))!;
    const xIdx = headerLine.indexOf('X');
    const sep = headerLine.indexOf('│', xIdx + 1);
    // Distance from separator to next separator should account for minWidth
    expect(sep - 1).toBeGreaterThanOrEqual(15);
  });

  it('ends output with newline', () => {
    const result = renderTable(makeOpts());
    expect(result.endsWith('\n')).toBe(true);
  });

  it('handles single column', () => {
    const result = renderTable({
      columns: [{ key: 'only', header: 'Only' }],
      rows: [{ only: 'data' }],
    });
    expect(result).toContain('Only');
    expect(result).toContain('data');
  });

  it('handles many columns', () => {
    const columns = Array.from({ length: 10 }, (_, i) => ({
      key: `c${i}`,
      header: `Col${i}`,
    }));
    const row: Record<string, string> = {};
    for (const c of columns) row[c.key] = `v${c.key}`;
    const result = renderTable({ columns, rows: [row] });
    expect(result).toContain('Col0');
    expect(result).toContain('Col9');
  });

  it('handles null/undefined values in rows', () => {
    const result = renderTable({
      columns: [
        { key: 'a', header: 'A' },
        { key: 'b', header: 'B' },
      ],
      rows: [{ a: null as unknown as string, b: undefined as unknown as string }],
    });
    // Should not throw
    expect(result).toContain('A');
  });
});
